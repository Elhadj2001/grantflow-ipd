/**
 * Sprint F-ADMIN-USERS Lot A — tests unitaires KeycloakAdminService.
 *
 * Stratégie : on stub `global.fetch` plutôt qu'un vrai Keycloak. Couvre :
 *   - token client_credentials + cache
 *   - createUser : succès (location header), 409 (e-mail déjà pris),
 *     fetch error réseau, autre 4xx/5xx
 *   - assignRealmRoles : flux refs + POST
 *   - sendResetPasswordEmail : PUT execute-actions-email
 *   - findUserByEmail : trouve / pas trouvé
 *   - mapping d'erreurs (IdpUnreachable / IdpAdminTokenFailed /
 *     IdpAdminOperationFailed / UserEmailAlreadyExists)
 */

import { ConfigService } from '@nestjs/config';
import {
  IdpAdminOperationFailedException,
  IdpAdminTokenFailedException,
  IdpUnreachableException,
  UserEmailAlreadyExistsException,
} from '../../../common/exceptions/business.exception';
import { KeycloakAdminService } from '../keycloak-admin.service';

const ENV = {
  KEYCLOAK_URL: 'http://keycloak.local',
  KEYCLOAK_REALM: 'grantflow',
  KEYCLOAK_CLIENT_ID: 'grantflow-api',
  KEYCLOAK_CLIENT_SECRET: 'top-secret-not-logged',
};

const cfg = new ConfigService(ENV);
// Sanity : getOrThrow exposé par ConfigService standard (lit `internalConfig`).
// On wrap pour s'assurer que les clés sont lues correctement par le service.
jest.spyOn(cfg, 'getOrThrow').mockImplementation(
  ((key: string) => {
    const v = (ENV as Record<string, string>)[key];
    if (!v) throw new Error(`Missing env ${key}`);
    return v;
  }) as unknown as ConfigService['getOrThrow'],
);

/** Helper : Response-like mock pour fetch. */
function mockResponse(opts: {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}): Response {
  const headers = new Headers(opts.headers);
  if (opts.json !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return {
    ok: opts.status >= 200 && opts.status < 300,
    status: opts.status,
    headers,
    json: async () => opts.json,
    text: async () => opts.text ?? JSON.stringify(opts.json ?? ''),
  } as unknown as Response;
}

describe('KeycloakAdminService', () => {
  let svc: KeycloakAdminService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    svc = new KeycloakAdminService(cfg);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ---------------- token / cache ----------------

  describe('getAdminAccessToken', () => {
    it('demande un token client_credentials et le met en cache', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          status: 200,
          json: { access_token: 'tok-1', expires_in: 300 },
        }),
      );

      const t1 = await svc.getAdminAccessToken();
      const t2 = await svc.getAdminAccessToken();
      expect(t1).toBe('tok-1');
      expect(t2).toBe('tok-1');
      // Un seul appel HTTP : le cache a servi le 2ᵉ.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://keycloak.local/realms/grantflow/protocol/openid-connect/token');
      expect((init.body as string).includes('grant_type=client_credentials')).toBe(true);
      expect((init.body as string).includes('client_id=grantflow-api')).toBe(true);
      // Le secret est transmis MAIS jamais loggé — on s'assure juste qu'il
      // est bien passé (la non-fuite est garantie par redact pino +
      // tests négatifs sur les logs).
      expect((init.body as string).includes('client_secret=')).toBe(true);
    });

    it('IdpUnreachable si fetch lève (réseau)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(svc.getAdminAccessToken()).rejects.toBeInstanceOf(IdpUnreachableException);
    });

    it('IdpAdminTokenFailed si réponse 401', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 401, text: 'unauthorized_client' }));
      await expect(svc.getAdminAccessToken()).rejects.toBeInstanceOf(
        IdpAdminTokenFailedException,
      );
    });

    it('IdpAdminTokenFailed si payload incomplet (pas d\'access_token)', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, json: { expires_in: 300 } }));
      await expect(svc.getAdminAccessToken()).rejects.toBeInstanceOf(
        IdpAdminTokenFailedException,
      );
    });
  });

  // ---------------- createUser ----------------

  describe('createUser', () => {
    function mockTokenOk() {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { access_token: 'tok', expires_in: 300 } }),
      );
    }

    it('renvoie le UUID extrait du Location header', async () => {
      mockTokenOk();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          status: 201,
          headers: { Location: 'http://keycloak.local/admin/realms/grantflow/users/abc-123' },
        }),
      );

      const uuid = await svc.createUser({
        email: 'new.user@pasteur.sn',
        fullName: 'Aïssatou DIALLO',
      });
      expect(uuid).toBe('abc-123');

      const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.email).toBe('new.user@pasteur.sn');
      expect(body.username).toBe('new.user@pasteur.sn');
      expect(body.firstName).toBe('Aïssatou');
      expect(body.lastName).toBe('DIALLO');
      expect(body.enabled).toBe(true);
      expect(body.emailVerified).toBe(false);
    });

    it('UserEmailAlreadyExists si Keycloak renvoie 409', async () => {
      mockTokenOk();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 409, text: 'User exists' }));
      await expect(
        svc.createUser({ email: 'dup@pasteur.sn', fullName: 'Dup User' }),
      ).rejects.toBeInstanceOf(UserEmailAlreadyExistsException);
    });

    it('IdpAdminOperationFailed sur autre erreur (500)', async () => {
      mockTokenOk();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 500, text: 'boom' }));
      await expect(
        svc.createUser({ email: 'x@y.z', fullName: 'X Y' }),
      ).rejects.toBeInstanceOf(IdpAdminOperationFailedException);
    });

    it('IdpUnreachable si fetch lève pendant le POST /users', async () => {
      mockTokenOk();
      fetchMock.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      await expect(
        svc.createUser({ email: 'x@y.z', fullName: 'X Y' }),
      ).rejects.toBeInstanceOf(IdpUnreachableException);
    });
  });

  // ---------------- role-mappings ----------------

  describe('assignRealmRoles / removeRealmRoles', () => {
    function mockTokenOk() {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { access_token: 'tok', expires_in: 300 } }),
      );
    }

    it('assignRealmRoles : récupère les refs puis POST role-mappings', async () => {
      mockTokenOk();
      // refs : 1 GET par rôle
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { id: 'r-1', name: 'DAF' } }),
      );
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { id: 'r-2', name: 'COMPTABLE' } }),
      );
      // POST role-mappings/realm → 204
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

      await svc.assignRealmRoles('kc-uuid', ['DAF', 'COMPTABLE']);

      const postCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      expect(postCall[0]).toBe(
        'http://keycloak.local/admin/realms/grantflow/users/kc-uuid/role-mappings/realm',
      );
      expect(postCall[1].method).toBe('POST');
      expect(JSON.parse(postCall[1].body as string)).toEqual([
        { id: 'r-1', name: 'DAF' },
        { id: 'r-2', name: 'COMPTABLE' },
      ]);
    });

    it('assignRealmRoles : no-op si liste vide (aucun fetch)', async () => {
      await svc.assignRealmRoles('kc-uuid', []);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('removeRealmRoles : DELETE role-mappings/realm avec les refs', async () => {
      mockTokenOk();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { id: 'r-1', name: 'COMPTABLE' } }),
      );
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

      await svc.removeRealmRoles('kc-uuid', ['COMPTABLE']);

      const deleteCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
      expect(deleteCall[1].method).toBe('DELETE');
    });

    it('getRealmRolesOfUser : renvoie une liste de noms', async () => {
      mockTokenOk();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          status: 200,
          json: [
            { id: 'r-1', name: 'DAF' },
            { id: 'r-2', name: 'COMPTABLE' },
          ],
        }),
      );
      const roles = await svc.getRealmRolesOfUser('kc-uuid');
      expect(roles).toEqual(['DAF', 'COMPTABLE']);
    });
  });

  // ---------------- email ----------------

  describe('sendResetPasswordEmail', () => {
    it('PUT execute-actions-email avec ["UPDATE_PASSWORD"]', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { access_token: 'tok', expires_in: 300 } }),
      );
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

      await svc.sendResetPasswordEmail('kc-uuid');

      const call = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(call[0]).toBe(
        'http://keycloak.local/admin/realms/grantflow/users/kc-uuid/execute-actions-email',
      );
      expect(call[1].method).toBe('PUT');
      expect(JSON.parse(call[1].body as string)).toEqual(['UPDATE_PASSWORD']);
    });

    it('IdpAdminOperationFailed si Keycloak renvoie 404 (user inconnu) ou autre erreur', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { access_token: 'tok', expires_in: 300 } }),
      );
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 404, text: 'User not found' }));
      await expect(svc.sendResetPasswordEmail('ghost')).rejects.toBeInstanceOf(
        IdpAdminOperationFailedException,
      );
    });
  });

  // ---------------- findUserByEmail / setUserEnabled ----------------

  describe('findUserByEmail', () => {
    it('renvoie le premier user trouvé', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { access_token: 'tok', expires_in: 300 } }),
      );
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          status: 200,
          json: [{ id: 'u1', username: 'x@y.z', email: 'x@y.z', enabled: true }],
        }),
      );
      const user = await svc.findUserByEmail('x@y.z');
      expect(user?.id).toBe('u1');
    });

    it('renvoie null si liste vide', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { access_token: 'tok', expires_in: 300 } }),
      );
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, json: [] }));
      const user = await svc.findUserByEmail('nobody@pasteur.sn');
      expect(user).toBeNull();
    });
  });

  describe('setUserEnabled', () => {
    it('PUT /users/:id avec {enabled}', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse({ status: 200, json: { access_token: 'tok', expires_in: 300 } }),
      );
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));

      await svc.setUserEnabled('kc-uuid', false);

      const call = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(call[0]).toBe('http://keycloak.local/admin/realms/grantflow/users/kc-uuid');
      expect(call[1].method).toBe('PUT');
      expect(JSON.parse(call[1].body as string)).toEqual({ enabled: false });
    });
  });
});
