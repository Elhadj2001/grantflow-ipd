/**
 * Rôles RBAC GRANTFLOW IPD.
 *
 * Source de vérité unique :
 *  - seed/roles.json           → table auth.role (Prisma)
 *  - docker/keycloak/realm.json → realm Keycloak (roles.realm)
 *
 * Toute modification de cette liste doit être faite en parallèle dans
 * ces deux fichiers + l'export ci-dessous. Aucun rôle ne doit être
 * introduit ailleurs.
 */
export const ROLES = [
  'SUPER_ADMIN',
  'DAF',
  'CONTROLEUR',
  'COMPTABLE',
  'TRESORIER',
  'ACHETEUR',
  'MAGASINIER',
  'PI',
  'DEMANDEUR',
  'BAILLEUR',
  'CAISSIER',
  // US-065 (ADR-006) : Grant Office — rédige/soumet/active les Notes
  // Techniques ; la VALIDATION reste DAF (SoD ADR-009).
  'GO',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
