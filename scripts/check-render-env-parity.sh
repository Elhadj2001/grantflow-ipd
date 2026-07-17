#!/usr/bin/env bash
# =====================================================================
#  GRANTFLOW IPD — Parité render.yaml ↔ inventaire env vars (US-142)
#  Vérifie que les variables boot-critiques ET fonctionnelles (non-boot)
#  de docs/deploy/env-vars-inventory.md sont déclarées (`- key: X`) dans
#  render.yaml. Les deux tiers sont rapportés séparément : l'app boote
#  sans le tier fonctionnel, mais features dégradées (mail 530, OCR
#  fallback pdf-parse — constaté post-migration Frankfurt 2026-07).
#  Usage : scripts/check-render-env-parity.sh
# =====================================================================
set -u
cd "$(dirname "$0")/.." || exit 2
RENDER="render.yaml"

# Variables BOOT-critiques (🔴) + fonctionnelle CORS (🟠) — service grantflow-api.
API_BOOT="DATABASE_URL KEYCLOAK_URL KEYCLOAK_REALM KEYCLOAK_CLIENT_ID KEYCLOAK_CLIENT_SECRET WEB_ORIGIN"
# Variables BOOT-critiques du service grantflow-keycloak.
KC_BOOT="KEYCLOAK_ADMIN KEYCLOAK_ADMIN_PASSWORD KC_HOSTNAME KC_HOSTNAME_STRICT_HTTPS KC_DB KC_DB_URL KC_DB_USERNAME KC_DB_PASSWORD KC_HTTP_ENABLED KC_HTTP_PORT"
# Tier FONCTIONNEL non-boot (🟠) — grantflow-api : l'API démarre sans elles
# mais mail KO (530 Authentication required) et OCR vision retombe sur
# pdf-parse. À restaurer à chaque recréation de service (render.md §9/§10).
API_FUNC="SMTP_USER SMTP_PASS ANTHROPIC_API_KEY"

missing_boot=0
missing_func=0
check() {
  local key="$1" tier="$2"
  if grep -qE "^\s*-\s*key:\s*${key}\s*$" "$RENDER"; then
    printf "  [OK]      %s\n" "$key"
  elif [ "$tier" = "func" ]; then
    printf "  [MISSING] %s\n" "$key"; missing_func=$((missing_func+1))
  else
    printf "  [MISSING] %s\n" "$key"; missing_boot=$((missing_boot+1))
  fi
}

echo "== grantflow-api (boot-critique) =="
for k in $API_BOOT; do check "$k" boot; done
echo "== grantflow-keycloak (boot-critique) =="
for k in $KC_BOOT; do check "$k" boot; done
echo "== grantflow-api (fonctionnelles non-boot) =="
for k in $API_FUNC; do check "$k" func; done

echo
if [ "$missing_boot" -eq 0 ] && [ "$missing_func" -eq 0 ]; then
  echo "PARITÉ OK — aucune variable boot-critique ni fonctionnelle manquante dans render.yaml."
  exit 0
else
  [ "$missing_boot" -gt 0 ] && echo "DIFF NON VIDE — $missing_boot variable(s) boot-critique(s) absente(s) de render.yaml."
  [ "$missing_func" -gt 0 ] && echo "DIFF NON VIDE — $missing_func variable(s) fonctionnelle(s) (non-boot) absente(s) de render.yaml."
  exit 1
fi
