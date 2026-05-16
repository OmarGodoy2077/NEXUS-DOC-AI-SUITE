# ============================================================
# NEXUS DOC AI SUITE — Setup automático (Windows PowerShell)
#
# Lo que hace:
#   1. Verifica Node.js >= 18 y PowerShell (para el scanner WIA)
#   2. Instala dependencias raíz, backend y frontend
#   3. Crea backend\.env y frontend\.env desde .env.example si no existen
#   4. Verifica que las claves clave estén llenas (avisa qué falta)
#   5. Imprime los pasos manuales restantes (Supabase, bucket, login)
#
# Uso:  pwsh -ExecutionPolicy Bypass -File .\setup.ps1
#       o:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Section($title) {
    Write-Host ""
    Write-Host "===> $title" -ForegroundColor Cyan
}

function Ok($msg)    { Write-Host "  [OK]    $msg" -ForegroundColor Green }
function Warn($msg)  { Write-Host "  [WARN]  $msg" -ForegroundColor Yellow }
function Fail($msg)  { Write-Host "  [ERROR] $msg" -ForegroundColor Red }

# ── 1. Verificar pre-requisitos ─────────────────────────────
Section "Verificando pre-requisitos"

try {
    $nodeVersion = (& node --version) -replace '^v',''
    $major = [int]($nodeVersion.Split('.')[0])
    if ($major -lt 18) {
        Fail "Node.js >= 18 requerido. Tienes v$nodeVersion. Descarga: https://nodejs.org/"
        exit 1
    }
    Ok "Node.js v$nodeVersion"
} catch {
    Fail "Node.js no instalado. Descarga: https://nodejs.org/"
    exit 1
}

try {
    $npmVersion = (& npm --version)
    Ok "npm v$npmVersion"
} catch {
    Fail "npm no disponible. Reinstala Node.js."
    exit 1
}

# Scanner WIA solo en Windows
if ($IsWindows -or $env:OS -eq "Windows_NT") {
    Ok "Windows detectado — el modulo Scanner WIA estara disponible"
} else {
    Warn "No estas en Windows. El endpoint /api/scanner devolvera 501 (no soportado)."
}

# ── 2. Instalar dependencias ────────────────────────────────
Section "Instalando dependencias (npm install x3)"

Push-Location $root
try {
    Write-Host "  - raiz"
    & npm install --silent
    if ($LASTEXITCODE -ne 0) { throw "npm install fallo en raiz" }

    Write-Host "  - backend"
    Push-Location (Join-Path $root "backend")
    try {
        & npm install --silent
        if ($LASTEXITCODE -ne 0) { throw "npm install fallo en backend" }
    } finally { Pop-Location }

    Write-Host "  - frontend"
    Push-Location (Join-Path $root "frontend")
    try {
        & npm install --silent
        if ($LASTEXITCODE -ne 0) { throw "npm install fallo en frontend" }
    } finally { Pop-Location }

    Ok "Dependencias instaladas"
} finally {
    Pop-Location
}

# ── 3. Crear .env desde .env.example si no existen ──────────
Section "Configurando variables de entorno (.env)"

function Copy-EnvIfMissing($folder) {
    $envPath = Join-Path $folder ".env"
    $examplePath = Join-Path $folder ".env.example"
    if (-not (Test-Path $envPath)) {
        if (Test-Path $examplePath) {
            Copy-Item $examplePath $envPath
            Warn "$envPath creado desde .env.example - completa las claves antes de iniciar"
        } else {
            Warn "Falta $examplePath; no se pudo crear $envPath"
        }
    } else {
        Ok "$envPath ya existe (no se sobrescribe)"
    }
}

Copy-EnvIfMissing (Join-Path $root "backend")
Copy-EnvIfMissing (Join-Path $root "frontend")

# ── 4. Verificar claves criticas (no las imprime, solo si estan llenas) ──
Section "Verificando claves en backend\.env"

$backendEnv = Join-Path $root "backend\.env"
if (Test-Path $backendEnv) {
    $content = Get-Content $backendEnv -Raw
    $checks = @(
        @{ Key = "SUPABASE_URL";              Pattern = "SUPABASE_URL=https://.+\.supabase\.co" },
        @{ Key = "SUPABASE_SERVICE_ROLE_KEY"; Pattern = "SUPABASE_SERVICE_ROLE_KEY=eyJ.+" },
        @{ Key = "GEMINI_API_KEY";            Pattern = "GEMINI_API_KEY=AIza.+" }
    )
    foreach ($c in $checks) {
        if ($content -match $c.Pattern) {
            Ok ("{0} configurada" -f $c.Key)
        } else {
            Warn ("{0} parece NO configurada en backend\.env" -f $c.Key)
        }
    }
}

# ── 5. Pasos manuales restantes ─────────────────────────────
Section "Pasos manuales restantes"

Write-Host ""
Write-Host "1) En Supabase (https://supabase.com):" -ForegroundColor White
Write-Host "   a. Crea un proyecto."
Write-Host "   b. SQL Editor -> ejecuta:"
Write-Host "      - backend/migrations/001_create_financial_schema.sql"
Write-Host "      - backend/migrations/002_migrate_transacciones.sql (solo si vienes de v1)"
Write-Host "   c. Storage -> New bucket: 'comprobantes' (privado)."
Write-Host "   d. Authentication -> Users -> Invite/Add user para tu login."
Write-Host "   e. Project Settings -> API: copia URL, anon key, service_role key."
Write-Host ""
Write-Host "2) Google AI Studio (https://aistudio.google.com/apikey):"
Write-Host "   Crea una API key gratuita para Gemini."
Write-Host ""
Write-Host "3) Pega las claves en:" -ForegroundColor White
Write-Host "   - backend\.env   (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY)"
Write-Host "   - frontend\.env  (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)"
Write-Host ""
Write-Host "4) Arranca el sistema (en dos terminales):"
Write-Host "   cd backend  ; npm run dev"
Write-Host "   cd frontend ; npm run dev"
Write-Host ""
Write-Host "5) Abre http://localhost:5173 e inicia sesion."
Write-Host ""
Ok "Setup terminado"
