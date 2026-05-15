import type { Role } from './roles';

/**
 * Abstraction du user authentifié, indépendante du provider IDP.
 *
 * Garantit que les services métier ne dépendent ni du format du JWT
 * Keycloak, ni d'aucune lib passport — uniquement de cette interface.
 * Si le provider change (Auth0, Cognito, …), seule JwtStrategy à réécrire.
 */
export interface AuthenticatedUser {
  /** Identifiant stable du user (Keycloak `sub`). UUID. */
  id: string;
  /** Adresse e-mail (vide si le claim est absent). */
  email: string;
  /** Nom complet affichable (claim `name` ou `preferred_username`). */
  fullName: string;
  /** Rôles RBAC validés (claim custom `roles`, fallback `realm_access.roles`). */
  roles: Role[];
}

/**
 * Alias spécifique au provider Keycloak. `KeycloakUser` implémente
 * `AuthenticatedUser` — on l'utilise dans la couche `auth/strategies/`
 * pour rendre explicite l'origine de la donnée. Le reste de l'app
 * (controllers, services) ne doit voir que `AuthenticatedUser`.
 */
export type KeycloakUser = AuthenticatedUser;
