import { Module } from '@nestjs/common';
import { KeycloakAdminService } from './keycloak-admin.service';

/**
 * Module du client Admin Keycloak.
 *
 * Sprint F-ADMIN-USERS Lot A : encapsule `KeycloakAdminService` pour
 * qu'il soit injectable dans n'importe quel autre module (en pratique :
 * `AdminUsersModule` du Lot B). Exporté tel quel pour rester réutilisable
 * (ex: synchroniser un statut Keycloak depuis le module de migration).
 */
@Module({
  providers: [KeycloakAdminService],
  exports: [KeycloakAdminService],
})
export class KeycloakAdminModule {}
