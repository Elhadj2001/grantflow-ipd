#!/bin/bash
# =====================================================================
#  GRANTFLOW IPD — Script de pre-warming des services Render
# =====================================================================
#
# Render free tier endort les services après 15 min sans trafic.
# Cold start = 30-60s API + 30-60s Keycloak = 1-2 min d'attente au pire.
#
# Ce script ping les endpoints /health pour réveiller les services en
# parallèle, puis attend 60s pour s'assurer qu'ils sont chauds avant
# une démo ou une session de travail.
#
# Usage :
#   chmod +x scripts/warmup-grantflow.sh
#   ./scripts/warmup-grantflow.sh
#
# Recommandation : lancer 2-5 minutes avant une démo, ou en début de
# session de travail. UptimeRobot prend le relais en continu (cf.
# docs/deploy/keep-alive.md).

set -euo pipefail

# ----- URLs (surchargables par variables d'env — migration de région :
#        API_HEALTH_URL=https://... ./scripts/warmup-grantflow.sh) -----
API_HEALTH_URL="${API_HEALTH_URL:-https://grantflow-api-cvde.onrender.com/api/v1/health}"
KEYCLOAK_HEALTH_URL="${KEYCLOAK_HEALTH_URL:-https://grantflow-keycloak.onrender.com/health/ready}"
WEB_URL="${WEB_URL:-https://grantflow-ipd-web.vercel.app}"

# ----- Couleurs -----
BLUE="\033[34m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

log() {
  echo -e "${BLUE}[$(date '+%H:%M:%S')]${RESET} $*"
}
success() {
  echo -e "${GREEN}✓${RESET} $*"
}
warn() {
  echo -e "${YELLOW}!${RESET} $*"
}
error() {
  echo -e "${RED}✗${RESET} $*" >&2
}

# ----- Test de connectivité avant warm-up -----
check_dns() {
  local name="$1"
  local url="$2"
  local host
  host=$(echo "$url" | sed -E 's|https?://||' | cut -d/ -f1)
  if ! getent hosts "$host" > /dev/null 2>&1; then
    error "DNS $host introuvable. URL invalide pour $name."
    return 1
  fi
  return 0
}

# ----- Ping avec mesure de durée -----
ping_endpoint() {
  local name="$1"
  local url="$2"
  local start
  local end
  local code
  local elapsed

  log "Ping $name → $url"
  start=$(date +%s)
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 120 "$url" 2>/dev/null || echo "000")
  end=$(date +%s)
  elapsed=$((end - start))

  if [[ "$code" == "200" ]]; then
    success "$name réveillé en ${elapsed}s (HTTP 200)"
    return 0
  elif [[ "$code" == "503" ]]; then
    warn "$name en cours de démarrage (HTTP 503). Retry dans 30s..."
    sleep 30
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 120 "$url" 2>/dev/null || echo "000")
    if [[ "$code" == "200" ]]; then
      success "$name réveillé au 2ᵉ essai"
    else
      error "$name toujours pas prêt (HTTP $code après retry)"
      return 1
    fi
  else
    error "$name HTTP $code après ${elapsed}s"
    return 1
  fi
}

# ----- Main -----
echo ""
log "🔥 Warm-up GRANTFLOW IPD"
log "Services cibles : API + Keycloak + Web"
echo ""

# Validation des URLs
if [[ "$API_HEALTH_URL" == *"XXXX"* ]]; then
  error "Édite ce script et remplace XXXX dans KEYCLOAK_HEALTH_URL par l'identifiant réel de ton service Render."
  exit 1
fi

check_dns "API" "$API_HEALTH_URL" || exit 1
check_dns "Keycloak" "$KEYCLOAK_HEALTH_URL" || exit 1
check_dns "Web" "$WEB_URL" || exit 1

# Ping en parallèle
log "Lancement des pings en parallèle..."
ping_endpoint "API" "$API_HEALTH_URL" &
PID_API=$!
ping_endpoint "Keycloak" "$KEYCLOAK_HEALTH_URL" &
PID_KC=$!
ping_endpoint "Web (Vercel)" "$WEB_URL" &
PID_WEB=$!

wait $PID_API && API_OK=1 || API_OK=0
wait $PID_KC && KC_OK=1 || KC_OK=0
wait $PID_WEB && WEB_OK=1 || WEB_OK=0

echo ""
log "Synthèse :"
[[ "$API_OK" == "1" ]] && success "API prêt" || error "API en erreur"
[[ "$KC_OK" == "1" ]] && success "Keycloak prêt" || error "Keycloak en erreur"
[[ "$WEB_OK" == "1" ]] && success "Web prêt" || error "Web en erreur"

if [[ "$API_OK" == "1" && "$KC_OK" == "1" && "$WEB_OK" == "1" ]]; then
  echo ""
  success "Tous les services sont chauds. Tu peux te connecter dès maintenant."
  echo ""
  exit 0
else
  echo ""
  warn "Certains services ont eu un problème. Vérifie les logs Render."
  echo ""
  exit 1
fi
