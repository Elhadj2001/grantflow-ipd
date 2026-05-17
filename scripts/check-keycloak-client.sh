#!/usr/bin/env bash
# =====================================================================
#  GRANTFLOW IPD — Diagnostic Keycloak (client grantflow-web)
#
#  Usage :   ./scripts/check-keycloak-client.sh
#  Env :     KC_URL (default http://localhost:8080)
#            KC_REALM (default grantflow)
#            KC_ADMIN_USER (default admin)
#            KC_ADMIN_PASS (default admin)
#            KC_TEST_USER (default amadou@pasteur.sn)
#            KC_TEST_PASS (default Pasteur2026!)
#
#  Vérifications :
#    1. Realm accessible (issuer + .well-known/openid-configuration)
#    2. Token admin obtenu (master realm)
#    3. Client grantflow-web existe + config affichée (redirect URIs,
#       webOrigins, publicClient, standardFlow…)
#    4. Secret client récupéré et affiché (prefix + length)
#    5. Direct grant login testé avec KC_TEST_USER (vérifie credentials
#       client + utilisateur d'un coup)
#    6. /api/auth/providers du Next.js (si UP) liste bien keycloak
#
#  Sortie 0 si tout OK, 1 sinon.
# =====================================================================

set -u

KC_URL="${KC_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-grantflow}"
KC_ADMIN_USER="${KC_ADMIN_USER:-admin}"
KC_ADMIN_PASS="${KC_ADMIN_PASS:-admin}"
KC_TEST_USER="${KC_TEST_USER:-amadou@pasteur.sn}"
KC_TEST_PASS="${KC_TEST_PASS:-Pasteur2026!}"
WEB_URL="${WEB_URL:-http://localhost:3000}"

if [ -t 1 ]; then
  G="\033[0;32m"; R="\033[0;31m"; Y="\033[0;33m"; B="\033[0;34m"; N="\033[0m"
else
  G=""; R=""; Y=""; B=""; N=""
fi

PASS=0
FAIL=0

ok()   { echo -e "${G}✓${N} $1"; PASS=$((PASS+1)); }
ko()   { echo -e "${R}✗${N} $1"; FAIL=$((FAIL+1)); }
info() { echo -e "${B}ℹ${N} $1"; }

# 1) Realm accessible -------------------------------------------------
echo ""
echo "=== 1. Realm $KC_REALM @ $KC_URL ==="
OIDC_URL="$KC_URL/realms/$KC_REALM/.well-known/openid-configuration"
HTTP=$(curl -s -o /tmp/oidc.json -w "%{http_code}" "$OIDC_URL")
if [ "$HTTP" = "200" ]; then
  ISSUER=$(grep -o '"issuer":"[^"]*"' /tmp/oidc.json | head -1 | cut -d'"' -f4)
  ok "OIDC discovery OK ($HTTP) — issuer=$ISSUER"
else
  ko "OIDC discovery KO ($HTTP) — Keycloak down ou realm absent ?"
  echo "  → vérifier 'docker compose ps keycloak' et docker/keycloak/realm.json"
  exit 1
fi

# 2) Token admin master ----------------------------------------------
echo ""
echo "=== 2. Token admin (master realm) ==="
ADMIN_TOKEN=$(curl -s -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" \
  -d "grant_type=password" \
  -d "username=$KC_ADMIN_USER" \
  -d "password=$KC_ADMIN_PASS" \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$ADMIN_TOKEN" ]; then
  ok "Admin token obtenu (len=${#ADMIN_TOKEN})"
else
  ko "Admin token KO — credentials admin/admin invalides ?"
  exit 1
fi

# 3) Client grantflow-web --------------------------------------------
echo ""
echo "=== 3. Client grantflow-web (realm $KC_REALM) ==="
CLIENTS_JSON=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$KC_URL/admin/realms/$KC_REALM/clients?clientId=grantflow-web")
CLIENT_ID=$(echo "$CLIENTS_JSON" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$CLIENT_ID" ]; then
  ok "Client grantflow-web trouvé (UUID=$CLIENT_ID)"

  PUBLIC=$(echo "$CLIENTS_JSON" | grep -o '"publicClient":[^,]*' | head -1 | cut -d':' -f2)
  STDFLOW=$(echo "$CLIENTS_JSON" | grep -o '"standardFlowEnabled":[^,]*' | head -1 | cut -d':' -f2)
  DIRECT=$(echo "$CLIENTS_JSON" | grep -o '"directAccessGrantsEnabled":[^,]*' | head -1 | cut -d':' -f2)
  info "publicClient=$PUBLIC  standardFlow=$STDFLOW  directAccessGrants=$DIRECT"

  REDIRECTS=$(echo "$CLIENTS_JSON" | grep -o '"redirectUris":\[[^]]*\]' | head -1)
  ORIGINS=$(echo "$CLIENTS_JSON" | grep -o '"webOrigins":\[[^]]*\]' | head -1)
  echo "  $REDIRECTS"
  echo "  $ORIGINS"

  if [ "$PUBLIC" != "false" ]; then
    ko "publicClient devrait être false (Client authentication ON requise pour next-auth confidential flow)"
  fi
  if [ "$STDFLOW" != "true" ]; then
    ko "standardFlowEnabled devrait être true (sinon callback OAuth impossible)"
  fi
  if ! echo "$REDIRECTS" | grep -q "$WEB_URL/api/auth/callback/keycloak"; then
    ko "Valid redirect URI MANQUANT : $WEB_URL/api/auth/callback/keycloak"
    echo "  → Admin Console : Clients > grantflow-web > Settings > Valid redirect URIs"
  fi
else
  ko "Client grantflow-web introuvable — créer via docs/keycloak-setup.md §2 ou §3"
  exit 1
fi

# 4) Secret client ----------------------------------------------------
echo ""
echo "=== 4. Secret client ==="
SECRET=$(curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$KC_URL/admin/realms/$KC_REALM/clients/$CLIENT_ID/client-secret" \
  | grep -o '"value":"[^"]*"' | cut -d'"' -f4)
if [ -n "$SECRET" ]; then
  SECRET_PREFIX="${SECRET:0:4}"
  ok "Secret récupéré : $SECRET_PREFIX... (len=${#SECRET})"
  info "→ À recopier intégralement dans apps/web/.env.local sous KEYCLOAK_SECRET"
  echo "  ── Comparer avec le log Next.js : '[next-auth][debug] ... secret prefix=$SECRET_PREFIX ...'"
else
  ko "Pas de secret retourné — vérifier que publicClient=false"
fi

# 5) Direct grant login (vérifie secret + user en 1 appel) -----------
echo ""
echo "=== 5. Direct grant : $KC_TEST_USER ==="
LOGIN_RESPONSE=$(curl -s -w "\nHTTP_STATUS:%{http_code}" \
  -X POST "$KC_URL/realms/$KC_REALM/protocol/openid-connect/token" \
  -d "client_id=grantflow-web" \
  -d "client_secret=$SECRET" \
  -d "grant_type=password" \
  -d "username=$KC_TEST_USER" \
  -d "password=$KC_TEST_PASS")
LOGIN_BODY=$(echo "$LOGIN_RESPONSE" | sed -n '1,$p' | grep -v "HTTP_STATUS:")
LOGIN_HTTP=$(echo "$LOGIN_RESPONSE" | grep "HTTP_STATUS:" | cut -d: -f2)
USER_TOKEN=$(echo "$LOGIN_BODY" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
if [ -n "$USER_TOKEN" ]; then
  ok "Login direct grant OK pour $KC_TEST_USER (token len=${#USER_TOKEN})"
else
  ERROR=$(echo "$LOGIN_BODY" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  ERROR_DESC=$(echo "$LOGIN_BODY" | grep -o '"error_description":"[^"]*"' | cut -d'"' -f4)
  ko "Login direct grant KO ($LOGIN_HTTP) — error=$ERROR ($ERROR_DESC)"
  case "$ERROR" in
    unauthorized_client)
      echo "  → directAccessGrantsEnabled=false OU client secret invalide."
      echo "    Fix : Admin Console > Clients > grantflow-web > Settings > 'Direct access grants' = ON"
      ;;
    invalid_client)
      echo "  → client secret incorrect."
      echo "    Fix : régénérer le secret (Credentials > Regenerate) puis MAJ .env.local"
      ;;
    invalid_grant)
      echo "  → user/password incorrect OU user en état 'temporary password'."
      echo "    Fix : kcadm set-password (cf. docs/keycloak-setup.md §6)"
      ;;
  esac
fi

# 6) /api/auth/providers du front (optionnel) -------------------------
echo ""
echo "=== 6. Next.js providers @ $WEB_URL ==="
HTTP=$(curl -s -o /tmp/providers.json -w "%{http_code}" "$WEB_URL/api/auth/providers" 2>/dev/null || echo "000")
if [ "$HTTP" = "200" ]; then
  if grep -q '"keycloak"' /tmp/providers.json; then
    ok "Next.js liste bien le provider keycloak"
  else
    ko "Next.js /api/auth/providers ne contient pas keycloak"
    cat /tmp/providers.json
  fi
elif [ "$HTTP" = "000" ]; then
  info "Next.js dev server non lancé sur $WEB_URL — étape skippée"
else
  ko "Next.js /api/auth/providers HTTP=$HTTP"
fi

# Bilan --------------------------------------------------------------
echo ""
echo "============================================================"
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${G}✅ Tous les contrôles ont passé ($PASS/$TOTAL).${N}"
  echo "  → Tester le flow complet : http://localhost:3000/login"
  echo "============================================================"
  exit 0
else
  echo -e "  ${R}❌ $FAIL/$TOTAL contrôle(s) en échec.${N}"
  echo "  → Voir docs/keycloak-setup.md §6 Troubleshooting"
  echo "============================================================"
  exit 1
fi
