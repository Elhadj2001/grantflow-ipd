# =====================================================================
#  GRANTFLOW IPD - Script de pre-warming Render (PowerShell Windows)
# =====================================================================
#
# Equivalent Windows natif du script warmup-grantflow.sh (WSL/Linux).
#
# Usage :
#   1. Edite les URLs ci-dessous si necessaire.
#   2. Ouvre PowerShell en tant qu'utilisateur (pas admin requis).
#   3. Si la 1ere execution echoue avec une erreur de signature :
#        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
#   4. Lance :  .\scripts\warmup-grantflow.ps1
#
# Note : ce script est en ASCII pur pour eviter les problemes d'encodage
# PowerShell 5.x sur Windows. Les accents sont volontairement absents.

# ----- URLs (surchargables par variables d'environnement) -----
# Migration de region Render : passer les nouvelles URLs SANS editer ce
# fichier :  $env:API_HEALTH_URL="https://..." ; .\scripts\warmup-grantflow.ps1
$ApiHealthUrl      = if ($env:API_HEALTH_URL)      { $env:API_HEALTH_URL }      else { "https://grantflow-api-udmd.onrender.com/api/v1/health" }
$KeycloakHealthUrl = if ($env:KEYCLOAK_HEALTH_URL) { $env:KEYCLOAK_HEALTH_URL } else { "https://grantflow-keycloak.onrender.com/health/ready" }
$WebUrl            = if ($env:WEB_URL)             { $env:WEB_URL }             else { "https://grantflow-ipd-web.vercel.app" }

# ----- Helpers couleurs -----
function Write-Log {
    param([string]$Message)
    $time = Get-Date -Format "HH:mm:ss"
    Write-Host "[$time] " -NoNewline -ForegroundColor Blue
    Write-Host $Message
}
function Write-Ok {
    param([string]$Message)
    Write-Host "  [OK] " -NoNewline -ForegroundColor Green
    Write-Host $Message
}
function Write-Warn {
    param([string]$Message)
    Write-Host "  [!]  " -NoNewline -ForegroundColor Yellow
    Write-Host $Message
}
function Write-Err {
    param([string]$Message)
    Write-Host "  [X]  " -NoNewline -ForegroundColor Red
    Write-Host $Message
}

# ----- Ping avec mesure de duree -----
function Ping-Endpoint {
    param([string]$Name, [string]$Url)

    Write-Log "Ping $Name -> $Url"
    $sw = [Diagnostics.Stopwatch]::StartNew()

    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 120 -UseBasicParsing -ErrorAction Stop
        $sw.Stop()
        $elapsed = [Math]::Round($sw.Elapsed.TotalSeconds, 0)
        if ($response.StatusCode -eq 200) {
            Write-Ok "$Name reveille en ${elapsed}s (HTTP 200)"
            return $true
        }
        else {
            Write-Warn "$Name HTTP $($response.StatusCode) apres ${elapsed}s"
            return $false
        }
    }
    catch [System.Net.WebException] {
        $sw.Stop()
        $elapsed = [Math]::Round($sw.Elapsed.TotalSeconds, 0)
        $statusCode = 0
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($statusCode -eq 503) {
            Write-Warn "$Name en cours de demarrage (HTTP 503). Retry dans 30s..."
            Start-Sleep -Seconds 30
            try {
                $r2 = Invoke-WebRequest -Uri $Url -TimeoutSec 120 -UseBasicParsing -ErrorAction Stop
                if ($r2.StatusCode -eq 200) {
                    Write-Ok "$Name reveille au 2e essai"
                    return $true
                }
                else {
                    Write-Err "$Name HTTP $($r2.StatusCode) apres retry"
                    return $false
                }
            }
            catch {
                Write-Err "$Name toujours pas pret apres retry"
                return $false
            }
        }
        else {
            Write-Err "$Name erreur HTTP $statusCode apres ${elapsed}s"
            return $false
        }
    }
    catch {
        Write-Err "$Name erreur inattendue : $($_.Exception.Message)"
        return $false
    }
}

# ----- Main -----
Write-Host ""
Write-Log "=== Warm-up GRANTFLOW IPD ==="
Write-Log "Services cibles : API + Keycloak + Web"
Write-Host ""

$apiOk = Ping-Endpoint -Name "API"          -Url $ApiHealthUrl
$kcOk  = Ping-Endpoint -Name "Keycloak"     -Url $KeycloakHealthUrl
$webOk = Ping-Endpoint -Name "Web (Vercel)" -Url $WebUrl

Write-Host ""
Write-Log "Synthese :"
if ($apiOk) { Write-Ok "API pret" }      else { Write-Err "API en erreur" }
if ($kcOk)  { Write-Ok "Keycloak pret" } else { Write-Err "Keycloak en erreur" }
if ($webOk) { Write-Ok "Web pret" }      else { Write-Err "Web en erreur" }

Write-Host ""
if ($apiOk -and $kcOk -and $webOk) {
    Write-Ok "Tous les services sont chauds. Tu peux te connecter des maintenant."
    Write-Host ""
    exit 0
}
else {
    Write-Warn "Certains services ont eu un probleme. Verifie les logs Render."
    Write-Host ""
    exit 1
}
