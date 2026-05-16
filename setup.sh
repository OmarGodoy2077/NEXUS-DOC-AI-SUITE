#!/usr/bin/env bash
# ============================================================
# NEXUS DOC AI SUITE — Setup automático (macOS / Linux / WSL)
# Equivalente a setup.ps1 para usuarios fuera de PowerShell.
#
# El módulo Scanner WIA solo funciona en Windows nativo.
# Uso:  bash ./setup.sh
# ============================================================

set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'

section() { printf "\n${CYAN}===> %s${NC}\n" "$1"; }
ok()      { printf "  ${GREEN}[OK]${NC}    %s\n" "$1"; }
warn()    { printf "  ${YELLOW}[WARN]${NC}  %s\n" "$1"; }
fail()    { printf "  ${RED}[ERROR]${NC} %s\n" "$1"; }

# ── 1. Pre-requisitos ───────────────────────────────────────
section "Verificando pre-requisitos"

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js no instalado. https://nodejs.org/"; exit 1
fi
NODE_MAJOR=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js >= 18 requerido. Tienes $(node --version)."; exit 1
fi
ok "Node.js $(node --version)"
ok "npm $(npm --version)"

OS=$(uname -s)
if [[ "$OS" != "MINGW"* && "$OS" != "CYGWIN"* && "$OS" != "MSYS"* ]]; then
  warn "No estás en Windows. El endpoint /api/scanner devolverá 501 (no soportado)."
fi

# ── 2. npm install ──────────────────────────────────────────
section "Instalando dependencias"
( cd "$ROOT"          && npm install --silent ); ok "raíz"
( cd "$ROOT/backend"  && npm install --silent ); ok "backend"
( cd "$ROOT/frontend" && npm install --silent ); ok "frontend"

# ── 3. .env desde .env.example ──────────────────────────────
section "Configurando variables de entorno"
copy_env_if_missing() {
  local folder="$1"
  if [ ! -f "$folder/.env" ]; then
    if [ -f "$folder/.env.example" ]; then
      cp "$folder/.env.example" "$folder/.env"
      warn "$folder/.env creado desde .env.example — completa las claves"
    else
      warn "$folder/.env.example no existe, omitido"
    fi
  else
    ok "$folder/.env ya existe (no se sobrescribe)"
  fi
}
copy_env_if_missing "$ROOT/backend"
copy_env_if_missing "$ROOT/frontend"

# ── 4. Verificar claves ─────────────────────────────────────
section "Verificando claves en backend/.env"
if [ -f "$ROOT/backend/.env" ]; then
  for k in "SUPABASE_URL=https" "SUPABASE_SERVICE_ROLE_KEY=eyJ" "GEMINI_API_KEY=AIza"; do
    name="${k%%=*}"
    if grep -q "^$k" "$ROOT/backend/.env"; then
      ok "$name configurada"
    else
      warn "$name parece NO configurada en backend/.env"
    fi
  done
fi

# ── 5. Pasos manuales ───────────────────────────────────────
section "Pasos manuales restantes"
cat <<EOF

1) En Supabase (https://supabase.com):
   a. Crea un proyecto.
   b. SQL Editor → ejecuta:
      - backend/migrations/001_create_financial_schema.sql
      - backend/migrations/002_migrate_transacciones.sql  (solo si vienes de v1)
   c. Storage → New bucket: 'comprobantes' (privado).
   d. Authentication → Users → Add user para tu login.
   e. Project Settings → API: copia URL, anon key, service_role key.

2) Google AI Studio (https://aistudio.google.com/apikey):
   Crea una API key para Gemini.

3) Pega las claves en backend/.env y frontend/.env.

4) Arranca el sistema (en dos terminales):
   cd backend  && npm run dev
   cd frontend && npm run dev

5) Abre http://localhost:5173 e inicia sesión.

EOF
ok "Setup terminado"
