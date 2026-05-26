import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IdpAdminOperationFailedException,
  IdpAdminTokenFailedException,
  IdpUnreachableException,
  UserEmailAlreadyExistsException,
  UserNotFoundException,
} from '../../common/exceptions/business.exception';

/**
 * Représentation minimale d'un user Keycloak telle que renvoyée par
 * `/admin/realms/{realm}/users`. Beaucoup d'autres champs existent ;
 * on type uniquement ce que ce service consomme.
 */
export interface KeycloakUserSummary {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
}

/** Forme d'un realm role tel que renvoyé par `/admin/realms/{realm}/roles/{name}`. */
export interface KeycloakRealmRoleRef {
  /** UUID Keycloak du rôle (utilisé par les endpoints role-mappings). */
  id: string;
  /** Nom du rôle (= code dans notre table `auth.role`). */
  name: string;
}

/**
 * Marge de sécurité (s) appliquée à `expires_in` avant de re-demander un
 * token. Couvre la latence réseau et l'horloge mal synchronisée. Au-delà,
 * Keycloak rejetterait le token comme expiré.
 */
const TOKEN_REFRESH_MARGIN_SECONDS = 30;

/**
 * Service d'accès à l'Admin REST API de Keycloak.
 *
 * Responsabilités :
 *  - Obtient et met en cache un access token via `client_credentials` (le
 *    service account du client `grantflow-api` doit avoir les rôles
 *    `realm-management` : view-users, query-users, manage-users, view-realm).
 *  - Expose des opérations métier (createUser, setEnabled, role-mappings,
 *    sendResetPasswordEmail, findByEmail) en masquant les détails HTTP.
 *  - Mappe les erreurs HTTP Keycloak (4xx/5xx, fetch fail) vers les
 *    BusinessException du catalogue (`UserEmailAlreadyExists`,
 *    `IdpUnreachable`, etc.) pour que le controller n'ait jamais à voir
 *    de réponse Keycloak brute.
 *
 * Sécurité :
 *  - Le secret du client est lu depuis `KEYCLOAK_CLIENT_SECRET` (jamais
 *    en dur). Aucun log ne contient le token ni le secret.
 *  - Les e-mails sont passés en payload mais ne sont jamais inclus dans
 *    les messages d'exception (cf. CLAUDE.md §6 — pas de PII en logs).
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);

  private readonly baseUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(config: ConfigService) {
    this.baseUrl = config.getOrThrow<string>('KEYCLOAK_URL');
    this.realm = config.getOrThrow<string>('KEYCLOAK_REALM');
    this.clientId = config.getOrThrow<string>('KEYCLOAK_CLIENT_ID');
    this.clientSecret = config.getOrThrow<string>('KEYCLOAK_CLIENT_SECRET');
  }

  // ------------------------------------------------------------------
  //  Token (client_credentials)
  // ------------------------------------------------------------------

  /**
   * Récupère un access token valide, en cache pendant `expires_in - margin`.
   * Renvoie immédiatement le token cache si encore frais.
   *
   * @internal — public uniquement pour faciliter les tests unitaires
   *  (couper le cache, forcer un re-fetch).
   */
  async getAdminAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now) {
      return this.tokenCache.token;
    }

    const tokenUrl = `${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (e) {
      // Fetch en erreur réseau (DNS, ECONNREFUSED, timeout) — Keycloak
      // n'est pas joignable. On NE log JAMAIS le secret/body.
      throw new IdpUnreachableException(e instanceof Error ? e.message : String(e));
    }

    if (!response.ok) {
      // 401/403 = mauvais secret, 400 = mauvais grant, 500 = Keycloak KO.
      this.logger.error(
        { providerStatus: response.status, op: 'getAdminAccessToken' },
        'Keycloak admin token request failed',
      );
      throw new IdpAdminTokenFailedException(response.status);
    }

    const json = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token || typeof json.expires_in !== 'number') {
      throw new IdpAdminTokenFailedException(response.status);
    }

    this.tokenCache = {
      token: json.access_token,
      expiresAt: now + (json.expires_in - TOKEN_REFRESH_MARGIN_SECONDS) * 1000,
    };
    return json.access_token;
  }

  // ------------------------------------------------------------------
  //  Helpers HTTP — n'exposent JAMAIS d'objet Response brut
  // ------------------------------------------------------------------

  private adminUrl(path: string): string {
    return `${this.baseUrl}/admin/realms/${this.realm}${path}`;
  }

  /**
   * Wrapper fetch typé. Lève une BusinessException sur erreur réseau ou
   * réponse non-2xx (sauf si `expectedStatuses` couvre le code reçu).
   * Renvoie `null` quand la réponse est 204 (No Content).
   */
  private async adminFetch<T>(
    operation: string,
    path: string,
    init: RequestInit,
    expectedStatuses: number[] = [200, 201, 204],
  ): Promise<T | null> {
    const token = await this.getAdminAccessToken();
    let response: Response;
    try {
      response = await fetch(this.adminUrl(path), {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (e) {
      throw new IdpUnreachableException(e instanceof Error ? e.message : String(e));
    }

    if (!expectedStatuses.includes(response.status)) {
      const text = await response.text().catch(() => '');
      // Le texte d'erreur Keycloak contient parfois `errorMessage` —
      // utile en debug, jamais en réponse client.
      this.logger.warn(
        {
          op: operation,
          providerStatus: response.status,
          // tronqué — peut être verbeux ; pas de PII car opération admin
          providerBody: text.slice(0, 256),
        },
        'Keycloak admin operation failed',
      );
      throw new IdpAdminOperationFailedException(operation, response.status, text.slice(0, 256));
    }

    if (response.status === 204) return null;

    // Certaines opérations renvoient 201 sans body (Location header) :
    // dans ce cas, retourner null aussi.
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) return null;
    return (await response.json()) as T;
  }

  // ------------------------------------------------------------------
  //  Opérations User
  // ------------------------------------------------------------------

  /**
   * Crée un user dans Keycloak (sans password — l'utilisateur recevra un
   * e-mail "Update password" via `sendResetPasswordEmail`). Renvoie le
   * UUID Keycloak du user créé.
   *
   * Lève `UserEmailAlreadyExistsException` (409) si l'e-mail existe déjà.
   */
  async createUser(input: {
    email: string;
    fullName: string;
  }): Promise<string> {
    const [firstName, ...rest] = input.fullName.trim().split(/\s+/);
    const lastName = rest.join(' ') || firstName;

    const body = {
      // username = email pour cohérence avec `loginWithEmailAllowed=true`
      username: input.email,
      email: input.email,
      firstName,
      lastName,
      enabled: true,
      emailVerified: false,
    };

    const token = await this.getAdminAccessToken();
    let response: Response;
    try {
      response = await fetch(this.adminUrl('/users'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new IdpUnreachableException(e instanceof Error ? e.message : String(e));
    }

    if (response.status === 409) {
      throw new UserEmailAlreadyExistsException(input.email);
    }
    if (response.status !== 201) {
      const text = await response.text().catch(() => '');
      throw new IdpAdminOperationFailedException('createUser', response.status, text.slice(0, 256));
    }

    // Keycloak renvoie l'ID dans le header `Location: /admin/realms/{r}/users/{uuid}`.
    const location = response.headers.get('location') ?? '';
    const uuid = location.split('/').pop();
    if (!uuid) {
      throw new IdpAdminOperationFailedException('createUser', response.status, 'missing Location');
    }
    return uuid;
  }

  /** PUT /users/{id} avec `enabled: bool`. */
  async setUserEnabled(kcUserId: string, enabled: boolean): Promise<void> {
    await this.adminFetch<void>(
      'setUserEnabled',
      `/users/${kcUserId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      },
      [204],
    );
  }

  /** PUT /users/{id} avec firstName/lastName/email synchronisés depuis AppUser. */
  async updateUserProfile(
    kcUserId: string,
    profile: { fullName?: string; email?: string },
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (profile.fullName) {
      const [firstName, ...rest] = profile.fullName.trim().split(/\s+/);
      update.firstName = firstName;
      update.lastName = rest.join(' ') || firstName;
    }
    if (profile.email) {
      update.email = profile.email;
      update.username = profile.email;
    }
    if (Object.keys(update).length === 0) return;
    await this.adminFetch<void>(
      'updateUserProfile',
      `/users/${kcUserId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      },
      [204],
    );
  }

  /**
   * Recherche un user Keycloak par e-mail exact (`?email=...&exact=true`).
   * Renvoie `null` s'il n'existe pas. Utile pour le merge AppUser ↔ Keycloak
   * dans la liste admin.
   */
  async findUserByEmail(email: string): Promise<KeycloakUserSummary | null> {
    const path = `/users?email=${encodeURIComponent(email)}&exact=true`;
    const users = await this.adminFetch<KeycloakUserSummary[]>('findUserByEmail', path, {
      method: 'GET',
    });
    if (!users || users.length === 0) return null;
    return users[0] ?? null;
  }

  /** GET /users/{id} — renvoie le user complet ou lève UserNotFoundException. */
  async getUserById(kcUserId: string): Promise<KeycloakUserSummary> {
    const user = await this.adminFetch<KeycloakUserSummary>(
      'getUserById',
      `/users/${kcUserId}`,
      { method: 'GET' },
      [200],
    );
    if (!user) throw new UserNotFoundException(kcUserId);
    return user;
  }

  /**
   * Renvoie les realm roles assignés à un user (filtrés par les noms
   * connus de notre table `auth.role`). On ne renvoie QUE les noms ;
   * l'appelant peut ainsi comparer simplement avec `UserRole`.
   */
  async getRealmRolesOfUser(kcUserId: string): Promise<string[]> {
    const roles = await this.adminFetch<KeycloakRealmRoleRef[]>(
      'getRealmRolesOfUser',
      `/users/${kcUserId}/role-mappings/realm`,
      { method: 'GET' },
      [200],
    );
    return (roles ?? []).map((r) => r.name);
  }

  /**
   * Résolution batch des refs `{id, name}` pour une liste de noms de rôles.
   * Nécessaire car les endpoints role-mappings exigent l'UUID + le name —
   * pas juste le name.
   */
  async getRealmRoleRefs(roleNames: string[]): Promise<KeycloakRealmRoleRef[]> {
    if (roleNames.length === 0) return [];
    // Keycloak n'expose pas d'endpoint batch — un GET par nom. C'est OK :
    // appelé uniquement sur create/setRoles (rare) et le cache token absorbe.
    const refs: KeycloakRealmRoleRef[] = [];
    for (const name of roleNames) {
      const ref = await this.adminFetch<KeycloakRealmRoleRef>(
        'getRealmRoleByName',
        `/roles/${encodeURIComponent(name)}`,
        { method: 'GET' },
        [200],
      );
      if (ref) refs.push(ref);
    }
    return refs;
  }

  /** POST /users/{id}/role-mappings/realm — ajoute des realm roles. */
  async assignRealmRoles(kcUserId: string, roleNames: string[]): Promise<void> {
    if (roleNames.length === 0) return;
    const refs = await this.getRealmRoleRefs(roleNames);
    if (refs.length === 0) return;
    await this.adminFetch<void>(
      'assignRealmRoles',
      `/users/${kcUserId}/role-mappings/realm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refs),
      },
      [204],
    );
  }

  /** DELETE /users/{id}/role-mappings/realm — retire des realm roles. */
  async removeRealmRoles(kcUserId: string, roleNames: string[]): Promise<void> {
    if (roleNames.length === 0) return;
    const refs = await this.getRealmRoleRefs(roleNames);
    if (refs.length === 0) return;
    await this.adminFetch<void>(
      'removeRealmRoles',
      `/users/${kcUserId}/role-mappings/realm`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(refs),
      },
      [204],
    );
  }

  /**
   * Envoie un e-mail Keycloak « Update password » via
   * `PUT /users/{id}/execute-actions-email` avec l'action `UPDATE_PASSWORD`.
   * Le user pourra cliquer sur le lien e-mail pour définir son mot de passe.
   *
   * Pré-requis : SMTP configuré côté Keycloak (cf. realm.json / Mailhog en dev).
   */
  async sendResetPasswordEmail(kcUserId: string): Promise<void> {
    await this.adminFetch<void>(
      'sendResetPasswordEmail',
      `/users/${kcUserId}/execute-actions-email`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(['UPDATE_PASSWORD']),
      },
      [204],
    );
  }
}
