import type { AuthenticatedUser } from './authenticated-user.type';

/**
 * Helpers RBAC partagés entre services (sprint F5b-a, Lot 1).
 *
 * On évite de coupler les services à NestJS (Reflector / Guards) pour
 * pouvoir filtrer côté service même quand l'appelant est interne
 * (job, autre service). Ces helpers ne font QUE de la logique pure.
 */

const PRIVILEGED_REPORTING_ROLES = ['CONTROLEUR', 'DAF', 'COMPTABLE', 'SUPER_ADMIN'] as const;

/**
 * Retourne vrai si l'acteur est un BAILLEUR "pur" — c'est-à-dire son
 * rôle EFFECTIF est BAILLEUR et il n'a aucun rôle interne IPD qui lui
 * donnerait accès aux brouillons / états en cours.
 *
 * Pourquoi ce test : Keycloak peut associer plusieurs rôles à un compte
 * (ex. un DAF qui a aussi BAILLEUR pour tester l'expérience auditeur).
 * Dans ce cas, on garde la visibilité large — c'est l'absence de rôle
 * interne qui restreint, pas la présence de BAILLEUR.
 */
export function isBailleurOnly(actor: AuthenticatedUser): boolean {
  if (!actor.roles.includes('BAILLEUR')) return false;
  return !PRIVILEGED_REPORTING_ROLES.some((r) =>
    (actor.roles as readonly string[]).includes(r),
  );
}
