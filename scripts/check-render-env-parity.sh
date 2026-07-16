#!/usr/bin/env bash
# =====================================================================
#  GRANTFLOW IPD — Parité render.yaml ↔ variables BOOT-critiques (US-142)
#  Vérifie que TOUTE variable boot-critique de docs/deploy/env-vars-inventory.md
#  est déclarée (`- key: X`) dans render.yaml. Sortie vide + exit 0 = aligné.
#  Usage : scripts/check-render-env-parity.sh
# =====================================================================
set -u
cd "$(dirname "$0")/.." || exit 2
RENDER="render.yaml"

# Variables BOOT-critiques (🔴) + fonctionnelle CORS (🟠) — service grantflow-api.
API_BOOT="DATABASE_URL KEYCLOAK_URL KEYCLOAK_REALM KEYCLOAK_CLIENT_ID KEYCLOAK_CLIENT_SECRET WEB_ORIGIN"
# Variables BOOT-critiques du service grantflow-keycloak.
KC_BOOT="KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD KC_HOSTNAME KC_DB KC_DB_URL KC_DB_USERNAME KC_DB_PASSWORD KC_HTTP_ENABLED KC_HTTP_PORT"

missing=0
check() {
  local key="$1"
  if grep -qE "^\s*-\s*key:\s*${key}\s*$" "$RENDER"; then
    printf "  [OK]      %s\n" "$key"
  else
    printf "  [MISSING] %s\n" "$key"; missing=$((missing+1))
  fi
}

echo "== grantflow-api (boot-critique) =="
for k in $API_BOOT; do check "$k"; done
echo "== grantflow-keycloak (boot-critique) =="
for k in $KC_BOOT; do check "$k"; done

echo
if [ "$missing" -eq 0 ]; then
  echo "PARITÉ OK — aucune variable boot-critique manquante dans render.yaml."
  exit 0
else
  echo "DIFF NON VIDE — $missing variable(s) boot-critique(s) absente(s) de render.yaml."
  exit 1
fi
