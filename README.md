# NEXUS DOC AI SUITE v2.1

Plataforma de procesamiento inteligente de documentos financieros, **importación SAT DTE-FEL (Guatemala)** y **conciliación contable N:M** entre facturas y métodos de pago, con OCR multimodal por IA y captura directa desde scanner físico.

> **Stack:** React + Vite + Tailwind (frontend) · Node.js + Express (backend) · Supabase Postgres + Storage · Google **Gemini 3.1 Flash-Lite** (OCR) · WIA / PowerShell (scanner).

---

## Tabla de contenidos
1. [Características](#características)
2. [Arquitectura general](#arquitectura-general)
3. [Pre-requisitos](#pre-requisitos)
4. [Instalación rápida (recomendada)](#instalación-rápida-recomendada)
5. [Instalación manual paso a paso](#instalación-manual-paso-a-paso)
6. [Configuración del scanner (WIA en Windows)](#configuración-del-scanner-wia-en-windows)
7. [Ejecutar el sistema](#ejecutar-el-sistema)
8. [Variables de entorno (referencia)](#variables-de-entorno-referencia)
9. [Mantenimiento y scripts útiles](#mantenimiento-y-scripts-útiles)
10. [Solución de problemas](#solución-de-problemas)
11. [Documentación técnica](#documentación-técnica)

---

## Características

- **OCR multimodal con IA** — Google **Gemini 3.1 Flash-Lite** analiza cheques manuscritos, transferencias y depósitos para extraer beneficiario, fecha, monto, banco, número de documento y tipo. Prompt especializado para Guatemala (Q, bancos locales, manuscritos cursivos).
- **Captura directa desde scanner físico** — Endpoint `/api/scanner` que usa **WIA (Windows Image Acquisition)** vía PowerShell para listar y capturar de cualquier scanner USB o de red (Epson, HP, Canon, Brother, multifuncionales). DPI y modo de color configurables. *Solo Windows.*
- **Importación SAT DTE-FEL** — Parser en dos pasos para archivos Excel de la Agencia Virtual SAT, con mapeo dinámico de columnas, deduplicación por número de autorización y soporte de notas de crédito.
- **Conciliación N:M** — Un cheque puede pagar varias facturas; una factura puede recibir varios pagos parciales. Triggers de PostgreSQL recalculan saldos y estados (`pendiente`/`parcial`/`pagada`) automáticamente.
- **Notas de crédito** — Tabla `aplicaciones_nota_credito` permite aplicar NCRE a facturas del mismo emisor; el trigger las incluye en el cálculo del estado.
- **Auditoría de costos de IA** — Cada documento procesado guarda `tokens_prompt`, `tokens_respuesta`, `tokens_total` y `ocr_modelo`. La página Admin proyecta el costo en USD.
- **RLS estricta** — `anon` y `authenticated` no leen tablas de negocio; solo el backend (con `service_role`) accede a los datos. Auth (login) funciona porque vive en el schema `auth.*`.
- **Modo borrador** — Los documentos recién OCRizados quedan en estado `borrador`; no aparecen como fondo disponible hasta que el usuario confirma o cancela (cancelar elimina BD + storage).
- **Modo pruebas** — `POST /api/admin/reset-all-data` con confirmación explícita borra todo y vacía el bucket para empezar de cero.

---

## Arquitectura general

```
                            ┌───────────────────────────┐
                            │   Supabase (Postgres)     │
   ┌────────────┐           │ ┌───────────────────────┐ │
   │  Browser   │ ───HTTPS─►│ │ Auth (login)          │ │
   │  React +   │           │ ├───────────────────────┤ │
   │  Vite      │           │ │ Storage 'comprobantes'│ │
   └─────┬──────┘           │ ├───────────────────────┤ │
         │ /api/*           │ │ facturas/metodos_pago/│ │
         │                  │ │ conciliaciones/etc.   │ │
         ▼                  │ │ (triggers + RLS)      │ │
   ┌──────────────┐  service_role key                   │
   │  Node.js     │ ────────────────────────────────────┘
   │  Express     │
   │  (puerto     │ ────► Google Gemini API (OCR)
   │   3000)      │ ────► PowerShell + WIA (scanner local)
   └──────────────┘
```

---

## Pre-requisitos

| Dependencia              | Versión mínima | Notas                                          |
|--------------------------|----------------|------------------------------------------------|
| **Node.js**              | 18.x           | LTS recomendado. https://nodejs.org/           |
| **npm**                  | 9.x            | Viene con Node.js                              |
| **Cuenta de Supabase**   | Free tier OK   | https://supabase.com/                          |
| **API key de Gemini**    | Free tier OK   | https://aistudio.google.com/apikey             |
| **Windows + PowerShell** | Windows 10/11  | *Solo si vas a usar el scanner WIA*            |

> No necesitas Tesseract, ni Ollama, ni Docker. El OCR ya no se ejecuta localmente: usa Gemini en la nube.

---

## Instalación rápida (recomendada)

Hay un script de setup que instala dependencias, crea archivos `.env` desde la plantilla y te dice qué te falta.

**Windows (PowerShell):**

```powershell
git clone <repo-url> nexus-doc-ai-suite
cd nexus-doc-ai-suite
npm run setup
```

**macOS / Linux / WSL:**

```bash
git clone <repo-url> nexus-doc-ai-suite
cd nexus-doc-ai-suite
npm run setup:sh
```

El script:
1. Verifica Node ≥ 18.
2. Ejecuta `npm install` en raíz, `backend/` y `frontend/`.
3. Copia `backend/.env.example` → `backend/.env` y `frontend/.env.example` → `frontend/.env` (sin sobrescribir si ya existen).
4. Verifica si las claves críticas están llenas.
5. Imprime los pasos manuales restantes (Supabase, bucket, login).

Tras el script, completa los archivos `.env` y sigue con [Configurar Supabase](#3-configurar-supabase).

---

## Instalación manual paso a paso

### 1. Clonar e instalar dependencias

```bash
git clone <repo-url> nexus-doc-ai-suite
cd nexus-doc-ai-suite
npm install                              # raíz (solo react-image-crop)
cd backend  && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Crear API key de Google Gemini

1. Entra a https://aistudio.google.com/apikey.
2. Crea una API key gratuita.
3. Guárdala para el paso 4.

### 3. Configurar Supabase

1. Crea un proyecto en https://supabase.com.
2. **Esquema de base de datos**
   - SQL Editor → pega y ejecuta:
     - [`backend/migrations/001_create_financial_schema.sql`](backend/migrations/001_create_financial_schema.sql) — schema completo (tablas, triggers, vistas, RLS).
     - [`backend/migrations/002_migrate_transacciones.sql`](backend/migrations/002_migrate_transacciones.sql) — **solo si migras desde la v1**.
3. **Storage**
   - Storage → **New bucket**: nombre `comprobantes`, **privado**. (Las URLs públicas se firman desde el backend cuando hace falta.)
4. **Autenticación**
   - Authentication → Users → **Add user** (email + password). Es el login que vas a usar en el frontend.
5. **Claves**
   - Project Settings → API: copia `Project URL`, `anon` key y `service_role` key. Guarda la `service_role` con cuidado — equivale a un admin de Postgres.

### 4. Variables de entorno

Si usaste el script de setup ya tienes los `.env`. Si no:

```bash
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env
```

Edita `backend/.env`:

```env
PORT=3000
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
GEMINI_API_KEY=<tu-gemini-key>
```

Edita `frontend/.env`:

```env
VITE_API_URL=http://localhost:3000/api
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

> Las `.env` están en `.gitignore`. Las plantillas `.env.example` sí se versionan.

---

## Configuración del scanner (WIA en Windows)

El módulo de scanner **no se instala con `npm install`**. Usa componentes nativos de Windows. Lo que necesitas:

1. **Sistema operativo:** Windows 10 / 11 (el endpoint devuelve `501 Platform not supported` en macOS/Linux).
2. **Servicio Windows Image Acquisition (WIA)** activo:
   ```powershell
   Get-Service stisvc          # Estado del servicio
   Start-Service stisvc        # Si está detenido
   Set-Service stisvc -StartupType Automatic
   ```
3. **Drivers del fabricante** instalados (Epson, HP, Canon, Brother, etc.). WIA detecta cualquier scanner que aparezca en `Panel de Control → Dispositivos e impresoras`.
4. **Política de ejecución de PowerShell** — el backend lanza el script con `-ExecutionPolicy Bypass`, así que no necesitas cambiar políticas globales. Si la antivirus/SEM corporativa bloquea PowerShell sin firmar, agrega [`backend/services/scanner-wia.ps1`](backend/services/scanner-wia.ps1) como excepción.

**No hay paquete npm para esto:** la integración es Node → `execFile('powershell.exe', ['-File', 'scanner-wia.ps1', ...])` → COM `WIA.DeviceManager`. Por eso no aparece en `package.json` y por eso `npm install` no lo cubre.

### Probar el scanner

```bash
curl http://localhost:3000/api/scanner/list
# Debe responder { success: true, count: N, scanners: [...] }
```

Si `count: 0`, abre `Devices and Printers` y verifica que tu scanner aparezca. Si Windows no lo ve, WIA tampoco lo verá.

### Configuración válida desde la UI

| Parámetro     | Valores                                  |
|---------------|------------------------------------------|
| `dpi`         | 75–600 (default 200)                     |
| `colorMode`   | `Color`, `Grayscale`, `BW`               |
| Timeout       | 120 s por escaneo, 10 s para listar       |
| Rate limit    | 30 requests/minuto por IP                |

### Si trabajas en macOS / Linux

El módulo `scannerService.js` lanza `PLATFORM_NOT_SUPPORTED`. Las páginas de captura siguen funcionando con upload de archivo / drag & drop. Puedes seguir usando el sistema sin scanner físico.

---

## Ejecutar el sistema

En dos terminales separadas:

```bash
# Terminal 1 — Backend (puerto 3000)
cd backend
npm run dev          # nodemon: recarga al guardar
# o:
npm start            # producción simple

# Terminal 2 — Frontend (puerto 5173)
cd frontend
npm run dev
```

Abre **http://localhost:5173** e inicia sesión con el usuario que creaste en Supabase Auth.

### Verificar que todo funciona

```bash
curl http://localhost:3000/api/health
# { "status": "OK", "version": "2.1.0", "modules": [...] }
```

### Flujo de usuario típico

1. **Login** (`/`) → email + password (Supabase Auth).
2. **Importar SAT** (`/importar-excel`) → sube Excel, revisa el mapeo sugerido, confirma. Las facturas entran como `pendiente`.
3. **Upload** (`/upload`) → sube imagen de cheque/transferencia (cámara, archivo, o **scanner físico** vía WIA). Recórtala si quieres. Gemini analiza, se guarda como `borrador`.
4. **Confirmar** método de pago → pasa a `disponible`.
5. **Conciliación** (`/conciliacion`) → selecciona factura + método de pago + monto. Los triggers ajustan estados.
6. **Admin** (`/admin`) → métricas, costos por token, proyecciones, reset de pruebas.

---

## Variables de entorno (referencia)

### `backend/.env`

| Variable                    | Obligatoria | Descripción                                                 |
|-----------------------------|:-----------:|-------------------------------------------------------------|
| `PORT`                      |             | Puerto HTTP del backend. Default `3000`.                    |
| `SUPABASE_URL`              | ✅          | URL del proyecto Supabase.                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅          | Service role key. **Bypassa RLS, no exponer al frontend.**  |
| `SUPABASE_KEY`              |             | Fallback (anon key) si falta la service_role.               |
| `GEMINI_API_KEY`            | ✅          | Google AI Studio. Sin ella el OCR falla.                    |

### `frontend/.env`

| Variable                  | Obligatoria | Descripción                                            |
|---------------------------|:-----------:|--------------------------------------------------------|
| `VITE_API_URL`            | ✅          | Base del backend. Default `http://localhost:3000/api`. |
| `VITE_SUPABASE_URL`       | ✅          | Misma URL que el backend.                              |
| `VITE_SUPABASE_ANON_KEY`  | ✅          | Anon key. Pública, segura para el navegador.           |

---

## Mantenimiento y scripts útiles

Desde la raíz del proyecto:

| Comando                          | Qué hace                                                                         |
|----------------------------------|----------------------------------------------------------------------------------|
| `npm run setup`                  | Setup completo (Windows / PowerShell).                                           |
| `npm run setup:sh`               | Setup completo (macOS / Linux / WSL).                                            |
| `npm run install:all`            | Instala dependencias en raíz, backend y frontend.                                |
| `npm run dev:backend`            | Inicia el backend con nodemon.                                                   |
| `npm run dev:frontend`           | Inicia el frontend con Vite.                                                     |
| `npm run build:frontend`         | Build de producción en `frontend/dist/`.                                         |
| `npm run cleanup:storage`        | Borra archivos huérfanos del bucket `comprobantes` (que ya no referencia la BD). |

Y en `backend/`:

| Comando             | Qué hace                                              |
|---------------------|-------------------------------------------------------|
| `npm run dev`       | Servidor con autoreload (nodemon).                    |
| `npm start`         | Servidor sin autoreload.                              |

---

## Solución de problemas

| Problema                                                       | Causa probable                              | Solución                                                                                |
|----------------------------------------------------------------|---------------------------------------------|-----------------------------------------------------------------------------------------|
| `⚠️ GEMINI_API_KEY no configurada` al arrancar                 | Falta o quedó como placeholder              | Pega tu key en `backend/.env` y reinicia.                                               |
| OCR responde `Error con Gemini: ...`                           | Key inválida o cuota agotada                | Revisa https://aistudio.google.com/apikey, regenera si hace falta.                      |
| `/api/scanner/list` devuelve `501 PLATFORM_NOT_SUPPORTED`      | Estás en macOS/Linux                        | El scanner WIA solo corre en Windows. Usa upload manual.                                |
| `/api/scanner/list` devuelve `count: 0`                        | El driver no expone el scanner a WIA        | Verifica en *Dispositivos e impresoras*; reinstala el driver del fabricante.            |
| `Error ejecutando PowerShell`                                  | Servicio WIA detenido / políticas estrictas | `Start-Service stisvc` + permitir `scanner-wia.ps1` en antivirus.                       |
| Frontend muestra "No autorizado"                               | Usuario no creado en Supabase Auth          | Authentication → Users → Add user.                                                      |
| Las tablas no existen al consultar                             | Migración 001 no se ejecutó                 | SQL Editor → corre `backend/migrations/001_create_financial_schema.sql` completo.       |
| Subir archivo a OCR da error 4xx en storage                    | Bucket `comprobantes` no existe             | Storage → New bucket → nombre exacto `comprobantes`.                                    |
| `POST /api/admin/reset-all-data` da 400                        | Falta la confirmación correcta              | El body debe ser `{ "confirmacion": "RESET NEXUS DOC AI" }`.                            |

---

## Documentación técnica

Documentación detallada disponible en:

- [TECHNICAL_DOCUMENTATION.md](TECHNICAL_DOCUMENTATION.md) — Diseño del modelo de datos, triggers, parser SAT, escenarios de negocio y endpoints.
- [backend/TECHNICAL_DOCUMENTATION.md](backend/TECHNICAL_DOCUMENTATION.md) — Arquitectura del backend, flujos clave y consideraciones de escalado.
- [frontend/TECHNICAL_DOCUMENTATION.md](frontend/TECHNICAL_DOCUMENTATION.md) — Estructura de componentes React, gestión de estado y patrones recomendados.

---

*Documentación actualizada para v2.1 — incluye Gemini OCR, módulo scanner WIA y migración consolidada (RLS estricta, notas de crédito, auditoría de tokens).*
