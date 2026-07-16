#!/usr/bin/env bash
# =====================================================================
#  GRANTFLOW IPD — Health-check prod (post-restauration Render)
#  Vérifie que l'API + Keycloak répondent et que la couche auth ne
#  renvoie PAS de 500 (symptôme d'un boot dégradé / config manquante).
#
#  Usage :
#    API_URL=https://grantflow-api-xxx.onrender.com \
#    KC_URL=https://grantflow-keycloak-xxx.onrender.com \
#      scripts/prod-health-check.sh
#
#  Optionnel — test authentifié (GET /grants → 200) :
#    DEMO_TOKEN=<bearer JWT>                       # token déjà obtenu, OU
#    DEMO_USER=... DEMO_PASS=... KC_CLIENT_SECRET=...   # password grant Keycloak
#
#  Sortie : [OK]/[X]/[SKIP] par étape. Exit code != 0 si une étape
#  critique échoue. Le 1er run peut être lent (cold start + réveil Neon).
# =====================================================================
set -u

API_URL="${API_URL:-https://grantflow-api-udmd.onrender.com}"
KC_URL="${KC_URL:-}"
KC_REALM="${KC_REALM:-grantflow}"
KC_CLIENT_ID="${KC_CLIENT_ID:-grantflow-api}"
TIMEOUT="${TIMEOUT:-25}"

# Couleurs (désactivées si sortie non-TTY).
if [ -t 1 ]; then G="\033[32m"; R="\033[31m"; Y="\033[33m"; B="\033[1m"; N="\033[0m"; else G=""; R=""; Y=""; B=""; N=""; fi
fails=0

ok()   { printf "  ${G}[OK]${N}   %s\n" "$1"; }
bad()  { printf "  ${R}[X]${N}    %s\n" "$1"; fails=$((fails+1)); }
skip() { printf "  ${Y}[SKIP]${N} %s\n" "$1"; }
head() { printf "\n${B}%s${N}\n" "$1"; }

# code_of URL [extra curl args...] → imprime le code HTTP (000 si injoignable).
code_of() { local url="$1"; shift; curl -s -o /dev/null -m "$TIMEOUT" -w "%{http_code}" "$@" "$url" 2>/dev/null || echo "000"; }

printf "${B}GRANTFLOW IPD — health-check prod${N}\n"
printf "API : %s\n" "$API_URL"
printf "KC  : %s\n" "${KC_URL:-'(non fourni)'}"

# 1) API /health → 200 + body JSON valide (status ok).
head "1. API /api/v1/health"
body="$(curl -s -m "$TIMEOUT" "$API_URL/api/v1/health" 2>/dev/null)"
code="$(code_of "$API_URL/api/v1/health")"
if [ "$code" = "200" ] && printf '%s' "$body" | grep -q '"status"'; then
  ok "200 + body JSON ($body)"
else
  bad "attendu 200+JSON, obtenu code=$code body=${body:-vide}"
fi

# 2) Keycloak /health/ready → 200.
head "2. Keycloak /health/ready"
if [ -z "$KC_URL" ]; then
  skip "KC_URL non fourni — export KC_URL=... pour tester Keycloak"
else
  code="$(code_of "$KC_URL/health/ready")"
  [ "$code" = "200" ] && ok "200 (ready)" || bad "attendu 200, obtenu $code"
fi

# 3) Endpoint auth-gardé SANS token → 401 (JAMAIS 500).
head "3. Auth guard — GET /api/v1/auth/me sans token"
code="$(code_of "$API_URL/api/v1/auth/me")"
if [ "$code" = "401" ]; then
  ok "401 (guard actif, pas de 500)"
elif [ "$code" = "500" ] || [ "$code" = "000" ]; then
  bad "code=$code → boot dégradé / API injoignable (500/timeout)"
else
  bad "attendu 401, obtenu $code"
fi

# 4) Ressource protégée SANS auth → 401.
head "4. RBAC — GET /api/v1/grants sans auth"
code="$(code_of "$API_URL/api/v1/grants")"
[ "$code" = "401" ] && ok "401 (protégé)" || bad "attendu 401, obtenu $code"

# 5) Ressource protégée AVEC token démo → 200 (optionnel).
head "5. Auth OK — GET /api/v1/grants avec bearer démo"
token="${DEMO_TOKEN:-}"
if [ -z "$token" ] && [ -n "${DEMO_USER:-}" ] && [ -n "${DEMO_PASS:-}" ] && [ -n "$KC_URL" ] && [ -n "${KC_CLIENT_SECRET:-}" ]; then
  token="$(curl -s -m "$TIMEOUT" -X POST \
    "$KC_URL/realms/$KC_REALM/protocol/openid-connect/token" \
    -d "grant_type=password" -d "client_id=$KC_CLIENT_ID" \
    -d "client_secret=$KC_CLIENT_SECRET" \
    -d "username=$DEMO_USER" -d "password=$DEMO_PASS" 2>/dev/null \
    | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)"
fi
if [ -z "$token" ]; then
  skip "fournir DEMO_TOKEN, ou DEMO_USER+DEMO_PASS+KC_CLIENT_SECRET(+KC_URL) pour ce test"
else
  code="$(code_of "$API_URL/api/v1/grants" -H "Authorization: Bearer $token")"
  [ "$code" = "200" ] && ok "200 (lecture authentifiée)" || bad "attendu 200, obtenu $code"
fi

# Résumé.
printf "\n${B}Résumé :${N} "
if [ "$fails" -eq 0 ]; then printf "${G}tout vert.${N}\n"; exit 0; else printf "${R}%d étape(s) en échec.${N}\n" "$fails"; exit 1; fi
