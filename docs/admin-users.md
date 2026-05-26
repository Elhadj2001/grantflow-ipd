# Administration des utilisateurs — Sprint F-ADMIN-USERS

## Vue d'ensemble

À partir de ce sprint, la **création, l'édition, l'activation, la
désactivation et la réinitialisation des mots de passe** des comptes
utilisateurs se font depuis l'application web GRANTFLOW (`/admin/users`),
et non plus depuis la console Keycloak.

**Approche hybride** :

- **Keycloak** reste la source de vérité des credentials (mot de passe,
  flag `enabled`, realm roles consommés par le JWT).
- **AppUser / UserRole** côté base applicative miroitent le profil
  (email, fullName, département, code RH, statut) et les rôles, pour
  l'affichage, la recherche et l'audit côté API.
- Toute mutation est répliquée des deux côtés dans le même service
  (`AdminUsersService`) — pas de divergence possible (et compensation
  Keycloak `setUserEnabled(false)` si la création AppUser échoue).

## Qui peut administrer les utilisateurs ?

| Rôle           | Voit l'entrée sidebar / les endpoints |
|----------------|----------------------------------------|
| `SUPER_ADMIN`  | ✅ Oui                                  |
| `DAF`          | ✅ Oui                                  |
| Tous les autres| ❌ 403 `AUTH.FORBIDDEN_ROLE`            |

Gating posé au niveau de la classe via `@Roles('SUPER_ADMIN', 'DAF')`
sur `AdminUsersController`. Le hook `usePermissions().canManageUsers()`
est strictement aligné.

## Endpoints

| Méthode | Route                                | Description                                         |
|---------|--------------------------------------|-----------------------------------------------------|
| GET     | `/admin/users`                       | Liste paginée + filtres `q` / `role` / `status`     |
| GET     | `/admin/users/:id`                   | Détail d'un utilisateur                             |
| POST    | `/admin/users`                       | Créer (KC → AppUser → assignRoles → mail invit.)    |
| PATCH   | `/admin/users/:id`                   | Mettre à jour le profil (fullName, dept, code RH)   |
| PUT     | `/admin/users/:id/roles`             | Remplacer l'ensemble des rôles (diff add/remove)    |
| POST    | `/admin/users/:id/activate`          | Réactiver (Keycloak `enabled=true` + AppUser actif) |
| POST    | `/admin/users/:id/deactivate`        | Désactiver (anti-self / anti-last-SUPER_ADMIN)      |
| POST    | `/admin/users/:id/reset-password`    | Envoie un mail Keycloak `UPDATE_PASSWORD`           |

## Garde-fous métier

1. **Anti-self-deactivate** — un utilisateur ne peut pas désactiver son
   propre compte. Le backend renvoie `409 BUSINESS.USER_CANNOT_DEACTIVATE_SELF`.
   Côté UI, le bouton "Désactiver" est désactivé pour la ligne de
   l'utilisateur courant.
2. **Anti-last-SUPER_ADMIN** — le service compte les autres `SUPER_ADMIN`
   actifs avant d'autoriser un retrait du rôle ou une désactivation. Si
   l'utilisateur ciblé est le dernier, l'opération est rejetée avec
   `409 BUSINESS.USER_CANNOT_REMOVE_LAST_SUPER_ADMIN`. Côté UI, le rôle
   `SUPER_ADMIN` est verrouillé (non cliquable) dans le sélecteur.
3. **Rôles inconnus** — toute tentative d'assigner un rôle absent de la
   table `auth.role` est rejetée avec `400 BUSINESS.USER_ROLE_UNKNOWN`.

## Pré-requis Keycloak (production + dev)

Le service account du client `grantflow-api` doit avoir les rôles client
`realm-management` suivants :

- `view-users`
- `query-users`
- `manage-users`
- `view-realm`

En **dev**, ces rôles sont déjà appliqués par `docker/keycloak/realm.json`
(user `service-account-grantflow-api` → `clientRoles."realm-management"`).
Si vous régénérez le realm, vérifiez après import dans la console
Keycloak (`Clients → grantflow-api → Service Account Roles`).

En **prod**, ils doivent être assignés manuellement via l'admin console
(ou via une routine d'init `kcadm.sh`).

Sans ces droits, **tous les endpoints `/admin/users/*` remontent 502**
avec le code `IDP.ADMIN_OPERATION_FAILED` (ou 401 si même le token
client_credentials est refusé : `IDP.ADMIN_TOKEN_FAILED`).

## Workflow de création d'un compte

1. **DAF / SA** ouvre `/admin/users`, clique **"Nouvel utilisateur"**.
2. Saisie : e-mail, nom complet, rôles (≥ 1), service et code RH optionnels.
3. Backend crée le user dans Keycloak (sans mot de passe).
4. Backend crée la ligne `AppUser` + `UserRole` (transaction).
5. Backend assigne les realm roles côté Keycloak.
6. Backend déclenche un e-mail Keycloak `UPDATE_PASSWORD` → l'utilisateur
   reçoit un lien (valable 12 h par défaut) pour définir son mot de passe.
7. Si étapes 4 ou 5 échouent (DB indisponible, Keycloak en erreur), le
   service exécute une **compensation** : `setUserEnabled(false)` côté
   Keycloak pour ne laisser aucun compte "fantôme" actif. L'erreur est
   remontée à l'admin avec son code et son statut HTTP.

## Sécurité — points de vigilance

- Aucun mot de passe en base — Keycloak gère exclusivement.
- Le secret du client (`KEYCLOAK_CLIENT_SECRET`) vit dans `.env` (jamais
  committé). En prod, utiliser un secret manager (Vault / Doppler / GH
  Actions secrets).
- Logs sans PII — les e-mails ne sont pas remontés dans les `details`
  des exceptions. Pino redact masque les champs `email` / `iban` /
  `password` / `authorization` au niveau du logger HTTP.
- Audit — toutes les mutations passent par l'`AuditLogInterceptor` global
  (cf. `apps/api/src/common/interceptors/audit-log.interceptor.ts`),
  donc `audit.event_log` enregistre actor + entité + opération avec hash
  chaîné SHA-256.

## Tests

- **Backend** : 46 cas (KeycloakAdminService 17 + AdminUsersService 19 +
  AdminUsersController RBAC + délégation 10).
- **Frontend** : 24 cas (lib/api 13 + permission 10 + sidebar entries 6
  + RoleSelector 6 + AdminUserForm 7).
