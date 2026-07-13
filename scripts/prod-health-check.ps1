<#
  GRANTFLOW IPD — Health-check prod (post-restauration Render), PowerShell.
  Vérifie API + Keycloak + couche auth (pas de 500).

  Usage :
    $env:API_URL="https://grantflow-api-xxx.onrender.com"
    $env:KC_URL="https://grantflow-keycloak-xxx.onrender.com"
    scripts\prod-health-check.ps1

  Optionnel — test authentifié (GET /grants -> 200) :
    $env:DEMO_TOKEN="<bearer JWT>"                     # token déjà obtenu, OU
    $env:DEMO_USER="..."; $env:DEMO_PASS="..."; $env:KC_CLIENT_SECRET="..."

  Sortie : [OK]/[X]/[SKIP] par étape. Exit code != 0 si échec critique.
#>
$ErrorActionPreference = 'SilentlyContinue'

$ApiUrl   = if ($env:API_URL) { $env:API_URL } else { 'https://grantflow-api-kqmv.onrender.com' }
$KcUrl    = $env:KC_URL
$KcRealm  = if ($env:KC_REALM) { $env:KC_REALM } else { 'grantflow' }
$KcClient = if ($env:KC_CLIENT_ID) { $env:KC_CLIENT_ID } else { 'grantflow-api' }
$TimeoutS = if ($env:TIMEOUT) { [int]$env:TIMEOUT } else { 25 }

$script:Fails = 0
function Ok($m)   { Write-Host "  [OK]   $m"   -ForegroundColor Green }
function Bad($m)  { Write-Host "  [X]    $m"   -ForegroundColor Red;    $script:Fails++ }
function Skip($m) { Write-Host "  [SKIP] $m"   -ForegroundColor Yellow }
function Section($m) { Write-Host "`n$m" -ForegroundColor Cyan }

# Retourne @{ Code=<int|0>; Body=<string> } pour une requête HTTP.
function Invoke-Http($Url, $Method = 'GET', $Headers = @{}, $Body = $null, $ContentType = $null) {
  try {
    $p = @{ Uri = $Url; Method = $Method; TimeoutSec = $TimeoutS; Headers = $Headers; UseBasicParsing = $true }
    if ($Body) { $p.Body = $Body }
    if ($ContentType) { $p.ContentType = $ContentType }
    $r = Invoke-WebRequest @p
    return @{ Code = [int]$r.StatusCode; Body = $r.Content }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode) { return @{ Code = [int]$resp.StatusCode; Body = '' } }
    return @{ Code = 0; Body = '' }
  }
}

Write-Host "GRANTFLOW IPD — health-check prod" -ForegroundColor White
Write-Host "API : $ApiUrl"
Write-Host ("KC  : " + $(if ($KcUrl) { $KcUrl } else { '(non fourni)' }))

# 1) API /health
Section "1. API /api/v1/health"
$r = Invoke-Http "$ApiUrl/api/v1/health"
if ($r.Code -eq 200 -and $r.Body -match '"status"') { Ok "200 + body JSON ($($r.Body))" }
else { Bad "attendu 200+JSON, obtenu code=$($r.Code) body=$($r.Body)" }

# 2) Keycloak /health/ready
Section "2. Keycloak /health/ready"
if (-not $KcUrl) { Skip 'KC_URL non fourni — $env:KC_URL=... pour tester Keycloak' }
else {
  $r = Invoke-Http "$KcUrl/health/ready"
  if ($r.Code -eq 200) { Ok '200 (ready)' } else { Bad "attendu 200, obtenu $($r.Code)" }
}

# 3) Auth guard sans token -> 401 (jamais 500)
Section "3. Auth guard — GET /api/v1/auth/me sans token"
$r = Invoke-Http "$ApiUrl/api/v1/auth/me"
if ($r.Code -eq 401) { Ok '401 (guard actif, pas de 500)' }
elseif ($r.Code -eq 500 -or $r.Code -eq 0) { Bad "code=$($r.Code) → boot dégradé / API injoignable" }
else { Bad "attendu 401, obtenu $($r.Code)" }

# 4) RBAC sans auth -> 401
Section "4. RBAC — GET /api/v1/grants sans auth"
$r = Invoke-Http "$ApiUrl/api/v1/grants"
if ($r.Code -eq 401) { Ok '401 (protégé)' } else { Bad "attendu 401, obtenu $($r.Code)" }

# 5) Lecture authentifiée -> 200 (optionnel)
Section "5. Auth OK — GET /api/v1/grants avec bearer démo"
$token = $env:DEMO_TOKEN
if (-not $token -and $env:DEMO_USER -and $env:DEMO_PASS -and $KcUrl -and $env:KC_CLIENT_SECRET) {
  $form = @{ grant_type='password'; client_id=$KcClient; client_secret=$env:KC_CLIENT_SECRET; username=$env:DEMO_USER; password=$env:DEMO_PASS }
  $tr = Invoke-Http "$KcUrl/realms/$KcRealm/protocol/openid-connect/token" 'POST' @{} $form 'application/x-www-form-urlencoded'
  if ($tr.Body -match '"access_token":"([^"]+)"') { $token = $Matches[1] }
}
if (-not $token) { Skip 'fournir DEMO_TOKEN, ou DEMO_USER+DEMO_PASS+KC_CLIENT_SECRET(+KC_URL)' }
else {
  $r = Invoke-Http "$ApiUrl/api/v1/grants" 'GET' @{ Authorization = "Bearer $token" }
  if ($r.Code -eq 200) { Ok '200 (lecture authentifiée)' } else { Bad "attendu 200, obtenu $($r.Code)" }
}

# Résumé
if ($script:Fails -eq 0) { Write-Host "`nRésumé : tout vert." -ForegroundColor Green; exit 0 }
else { Write-Host "`nRésumé : $($script:Fails) étape(s) en échec." -ForegroundColor Red; exit 1 }
