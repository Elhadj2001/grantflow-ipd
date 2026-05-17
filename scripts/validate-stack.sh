#!/usr/bin/env bash
# =====================================================================
#  GRANTFLOW IPD — Validation automatique de la stack dev
#
#  Usage :   ./scripts/validate-stack.sh
#
#  Pré-requis : docker compose up -d déjà lancé depuis la racine.
#
#  Le script vérifie en 5 étapes :
#    1. Les 5 conteneurs sont "healthy" ou "running"
#    2. L'API NestJS répond sur /api/v1/health
#    3. Keycloak expose son discovery OIDC pour le realm grantflow
#    4. MinIO répond (live + bucket grantflow-invoices créé si besoin)
#    5. PostgreSQL contient au moins 55 comptes SYSCEBNL (plancher,
#       de nouveaux comptes peuvent être ajoutés au fil des sprints)
#
#  Code de sortie : 0 si tout OK, 1 si au moins une vérification échoue.
# =====================================================================

set -u
# Pas de "set -e" : on veut continuer pour afficher tous les résultats.

# ---- Couleurs (désactivées hors TTY) ----
if [ -t 1 ]; then
  G="\033[0;32m"; R="\033[0;31m"; Y="\033[0;33m"; B="\033[0;34m"; N="\033[0m"
else
  G=""; R=""; Y=""; B=""; N=""
fi

PASS=0
FAIL=0

check() {
  local label="$1"
  local cmd="$2"
  local expect="${3:-}"

  echo -en "${B}[..]${N} ${label} ... "
  local out
  out=$(eval "$cmd" 2>&1)
  local rc=$?

  if [ "$rc" -ne 0 ]; then
    echo -e "${R}KO${N}"
    echo "     ↳ commande échouée : $cmd"
    echo "     ↳ $out" | head -3
    FAIL=$((FAIL+1))
    return 1
  fi

  if [ -n "$expect" ] && ! echo "$out" | grep -q "$expect"; then
    echo -e "${R}KO${N}"
    echo "     ↳ attendu : « $expect »"
    echo "     ↳ obtenu : $(echo "$out" | head -1)"
    FAIL=$((FAIL+1))
    return 1
  fi

  echo -e "${G}OK${N}"
  PASS=$((PASS+1))
  return 0
}

# Variante numérique : succès si sortie ≥ $expect_min. Utile pour les
# compteurs qui peuvent croître au fil des sprints (ex: comptes SYSCEBNL).
check_min() {
  local label="$1"
  local cmd="$2"
  local expect_min="$3"

  echo -en "${B}[..]${N} ${label} ... "
  local out
  out=$(eval "$cmd" 2>&1)
  local rc=$?

  if [ "$rc" -ne 0 ]; then
    echo -e "${R}KO${N}"
    echo "     ↳ commande échouée : $cmd"
    echo "     ↳ $out" | head -3
    FAIL=$((FAIL+1))
    return 1
  fi

  # Garde uniquement les chiffres pour parer aux retours bruités psql.
  local numeric
  numeric=$(echo "$out" | tr -dc '0-9' | head -c 10)
  if [ -z "$numeric" ] || [ "$numeric" -lt "$expect_min" ]; then
    echo -e "${R}KO${N}"
    echo "     ↳ attendu : au moins $expect_min"
    echo "     ↳ obtenu : $(echo "$out" | head -1)"
    FAIL=$((FAIL+1))
    return 1
  fi

  echo -e "${G}OK${N}"
  PASS=$((PASS+1))
  return 0
}

echo ""
echo "============================================================"
echo "  GRANTFLOW IPD — Validation stack dev"
echo "============================================================"
echo ""

# ---- 1) Docker disponible et conteneurs up ----
echo -e "${Y}1) Docker & conteneurs${N}"
check "docker CLI présent"          "docker --version"
check "docker compose présent"      "docker compose version"
check "service postgres healthy"    "docker compose ps postgres --format '{{.Status}}'"   "(healthy)"
check "service redis healthy"       "docker compose ps redis --format '{{.Status}}'"      "(healthy)"
check "service minio en marche"     "docker compose ps minio --format '{{.Status}}'"      "Up"
check "service keycloak en marche"  "docker compose ps keycloak --format '{{.Status}}'"   "Up"
check "service mailhog en marche"   "docker compose ps mailhog --format '{{.Status}}'"    "Up"

# ---- 2) API NestJS ----
echo ""
echo -e "${Y}2) API GRANTFLOW${N}"
check "API /health"  "curl -s -m 3 http://localhost:4000/api/v1/health"  '"status":"ok"'

# ---- 3) Keycloak OIDC ----
echo ""
echo -e "${Y}3) Keycloak — Realm grantflow${N}"
check "OIDC discovery"      "curl -s -m 3 http://localhost:8080/realms/grantflow/.well-known/openid-configuration"     '"issuer"'
check "JWKS endpoint"       "curl -s -m 3 http://localhost:8080/realms/grantflow/protocol/openid-connect/certs"       '"keys"'

# ---- 4) MinIO ----
echo ""
echo -e "${Y}4) MinIO Object Storage${N}"
check "MinIO live"          "curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:9000/minio/health/live"   "200"
check "Console MinIO"       "curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:9001/"                    "200"

# ---- 5) PostgreSQL — données SYSCEBNL ----
echo ""
echo -e "${Y}5) PostgreSQL — données SYSCEBNL${N}"
check_min "≥ 55 comptes SYSCEBNL chargés" \
  "docker compose exec -T postgres psql -U grantflow -d grantflow_dev -tAc 'SELECT count(*) FROM ref.gl_account;'" \
  "55"

check_min "≥ 10 rôles RBAC chargés" \
  "docker compose exec -T postgres psql -U grantflow -d grantflow_dev -tAc 'SELECT count(*) FROM auth.role;'" \
  "10"

check_min "≥ 9 bailleurs chargés" \
  "docker compose exec -T postgres psql -U grantflow -d grantflow_dev -tAc 'SELECT count(*) FROM ref.donor;'" \
  "9"

check_min "≥ 17 périodes fiscales 2026" \
  "docker compose exec -T postgres psql -U grantflow -d grantflow_dev -tAc 'SELECT count(*) FROM gl.fiscal_period;'" \
  "17"

check_min "≥ 3 donor_report_template seedés (sprint-6.1)" \
  "docker compose exec -T postgres psql -U grantflow -d grantflow_dev -tAc 'SELECT count(*) FROM reporting.donor_report_template;'" \
  "3"

# ---- Bilan ----
echo ""
echo "============================================================"
TOTAL=$((PASS+FAIL))
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${G}✅ Tous les contrôles ont passé ($PASS/$TOTAL).${N}"
  echo "============================================================"
  exit 0
else
  echo -e "  ${R}❌ $FAIL/$TOTAL contrôle(s) en échec.${N}"
  echo "  Voir les messages ci-dessus pour le détail."
  echo "============================================================"
  exit 1
fi
