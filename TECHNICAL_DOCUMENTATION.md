# NEXUS DOC AI SUITE — Documentación Técnica v2.1

> Diseño del modelo de datos, triggers, parser SAT, módulo de scanner, OCR con Gemini, escenarios de negocio y endpoints.
> Para instalación y configuración inicial consulta el [README.md](README.md).

---

## 1. Modelo de datos — Análisis y decisiones

El requerimiento central es la relación **N:M flexible** entre facturas y métodos de pago con control de saldos parciales y soporte de **notas de crédito**. El diseño se basa en cuatro entidades conectadas:

```
facturas ──────── conciliaciones ───────── metodos_pago
(DTE-FEL / OCR)   (pivot N:M)              (cheques, transferencias)
   │              monto_aplicado            monto_inicial
   │                                        saldo_utilizado (calculado)
   │
   └──── aplicaciones_nota_credito  (NCRE del mismo emisor sobre facturas)
```

**Decisiones clave:**
- `saldo_pendiente` en `facturas` y `saldo_disponible` en `metodos_pago` son columnas **GENERATED** (calculadas por PostgreSQL), nunca escritas desde la aplicación.
- Los estados (`pendiente → parcial → pagada`) los actualizan **triggers** `AFTER INSERT/UPDATE/DELETE` en `conciliaciones` y `aplicaciones_nota_credito`. Esto garantiza consistencia incluso con clientes concurrentes o inserciones directas en la BD.
- `numero_autorizacion` en `facturas` es UNIQUE: soporta `ON CONFLICT DO NOTHING` en importaciones masivas (deduplicación natural por UUID del SAT).
- **Estado `borrador`** en `metodos_pago` (migración 004): los documentos recién OCRizados quedan en borrador y no entran a las consultas de "fondos disponibles" hasta que el usuario los confirme. Si los cancela, se hace rollback de BD + storage.
- **Notas de crédito** (migración 007–010): facturas con `tipo_documento='nota_credito'` quedan permanentemente en estado `nota_credito` (no se concilian). Se aplican a facturas del mismo NIT emisor vía `aplicaciones_nota_credito`. El trigger de recálculo las suma como pago al actualizar la factura objetivo.
- **RLS estricta** (migración 011): `anon` y `authenticated` están denegados explícitamente; solo `service_role` (que bypassea RLS por privilegio) accede a los datos. Auth sigue funcionando porque vive en el schema `auth.*`.

---

## 2. Diagrama de tablas (ERD textual)

```
┌─────────────────────────────────────────────────────────┐
│                        facturas                         │
├─────────────────────────────────────────────────────────┤
│ id                  UUID PK                             │
│ numero_autorizacion TEXT UNIQUE  ← UUID del SAT         │
│ tipo_dte            VARCHAR(20)  ← FPEQ, FACT, NCRE...  │
│ serie / numero_dte                                      │
│ fecha_emision / fecha_anulacion                         │
│ marca_anulado / exportacion / ubicacion_temporal        │
│ nit_emisor / nombre_emisor                              │
│ codigo_establecimiento / nombre_establecimiento         │
│ id_receptor / nombre_receptor                           │
│ nit_certificador / nombre_certificador                  │
│ moneda                VARCHAR(5) DEFAULT 'GTQ'          │
│ monto_total           DECIMAL(15,2) NOT NULL            │
│ monto_iva             DECIMAL(15,2)                     │
│ otros_impuestos       JSONB                             │
│ monto_pagado          DECIMAL(15,2)  ← trigger          │
│ saldo_pendiente       DECIMAL GENERATED                 │
│ estado    ENUM(pendiente|parcial|pagada|anulada|        │
│                nota_credito)                            │
│ tipo_documento  ENUM(compra|venta|nota_credito|         │
│                       nota_debito|otro)                 │
│ origen          ENUM(sat_excel|ocr_upload|manual|       │
│                       importacion)                      │
│ url_archivo / raw_ocr / file_hash                       │
│ usuario_creacion / notas                                │
│ created_at / updated_at                                 │
└─────────────────────────────────────────────────────────┘
                  │ 1
                  │
                  │ N
┌─────────────────┴───────────────────────────────────────┐
│                     conciliaciones                      │
├─────────────────────────────────────────────────────────┤
│ id                   UUID PK                            │
│ factura_id           FK → facturas.id   ON DELETE RESTRICT │
│ metodo_pago_id       FK → metodos_pago.id ON DELETE RESTRICT │
│ monto_aplicado       DECIMAL(15,2) CHECK > 0            │
│ fecha_conciliacion   DATE                               │
│ usuario_conciliacion / notas                            │
│ created_at                                              │
│ UNIQUE (factura_id, metodo_pago_id, created_at)         │
└─────────────────────────────────────────────────────────┘
                  │ N
                  │
                  │ 1
┌─────────────────┴───────────────────────────────────────┐
│                     metodos_pago                        │
├─────────────────────────────────────────────────────────┤
│ id                UUID PK                               │
│ tipo  ENUM(cheque|transferencia|deposito|efectivo|      │
│            anticipo|otro)                               │
│ banco / numero_documento                                │
│ fecha_documento     DATE NOT NULL                       │
│ monto_inicial       DECIMAL(15,2) CHECK > 0             │
│ saldo_utilizado     DECIMAL(15,2)  ← trigger            │
│ saldo_disponible    DECIMAL GENERATED                   │
│ estado ENUM(borrador|disponible|utilizado_parcial|      │
│              utilizado_total|anulado)                   │
│ descripcion / url_comprobante / file_hash / raw_ocr     │
│ tokens_prompt / tokens_respuesta / tokens_total         │
│ ocr_modelo          VARCHAR(60)  ← p.ej. gemini-3.1-... │
│ origen              ENUM(sat_excel|ocr_upload|manual|...)│
│ usuario_creacion / notas                                │
│ created_at / updated_at                                 │
│ CHECK saldo_utilizado <= monto_inicial                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                aplicaciones_nota_credito                │
├─────────────────────────────────────────────────────────┤
│ id                UUID PK                               │
│ nota_credito_id   FK → facturas.id (tipo='nota_credito')│
│ factura_id        FK → facturas.id (factura objetivo)   │
│ monto_aplicado    DECIMAL(15,2) CHECK > 0               │
│ fecha_aplicacion / usuario_aplicacion / notas           │
│ UNIQUE (nota_credito_id, factura_id)                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  importaciones_excel                    │
├─────────────────────────────────────────────────────────┤
│ id / nombre_archivo                                     │
│ file_hash           TEXT UNIQUE                         │
│ total_filas / filas_importadas / filas_duplicadas /     │
│ filas_error                                             │
│ mapeo_columnas      JSONB                               │
│ periodo_desde / periodo_hasta                           │
│ estado_importacion / errores_detalle                    │
│ usuario_importacion / created_at                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  transacciones (legacy v1)              │
├─────────────────────────────────────────────────────────┤
│ id / beneficiario / monto / fecha_documento (TEXT)      │
│ url_archivo / raw_ocr / file_hash / usuario_email       │
│ created_at                                              │
│ — Preservada para histórico, no se elimina —            │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Triggers y lógica automática

### `trg_actualizar_factura` (AFTER INSERT/UPDATE/DELETE en conciliaciones)

Recalcula `monto_pagado` y `estado` de la factura afectada **sumando conciliaciones + NCRE aplicadas**:

```
monto_pagado     = SUM(conciliaciones.monto_aplicado WHERE factura_id=X)
                 + SUM(aplicaciones_nota_credito.monto_aplicado WHERE factura_id=X)
saldo_pendiente  = monto_total - monto_pagado   ← GENERATED

si tipo_documento = 'nota_credito'      → estado = 'nota_credito' (permanente)
si monto_pagado = 0                     → estado = 'pendiente'
si monto_pagado < monto_total           → estado = 'parcial'
si monto_pagado >= monto_total          → estado = 'pagada'
(facturas 'anuladas' y 'nota_credito' no se tocan)
```

### `trg_recalcular_factura_por_nc` (AFTER INSERT/UPDATE/DELETE en aplicaciones_nota_credito)

Mismo recálculo de arriba, disparado cuando se aplica o revierte una NCRE.

### `trg_actualizar_metodo_pago` (AFTER INSERT/UPDATE/DELETE en conciliaciones)

```
saldo_utilizado  = SUM(conciliaciones.monto_aplicado WHERE metodo_pago_id=X)
saldo_disponible = monto_inicial - saldo_utilizado   ← GENERATED

si saldo_utilizado = 0              → estado = 'disponible'
si saldo_utilizado < monto_inicial  → estado = 'utilizado_parcial'
si saldo_utilizado >= monto_inicial → estado = 'utilizado_total'

RAISE EXCEPTION si saldo_utilizado > monto_inicial   ← integridad

NO se sobrescriben registros en estado 'borrador' ni 'anulado'.
```

### `trg_facturas_updated_at` / `trg_metodos_pago_updated_at`

BEFORE UPDATE: setea `updated_at = NOW()`.

---

## 4. Row Level Security

Activado en: `facturas`, `metodos_pago`, `conciliaciones`, `importaciones_excel`, `aplicaciones_nota_credito`, `transacciones`.

Política única `deny_anon_auth`:

```sql
FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
```

`service_role` no aparece en la política porque Postgres lo bypassea por privilegio de superusuario lógico. El backend usa esta key vía `SUPABASE_SERVICE_ROLE_KEY`.

**Resultado:** quien tenga la URL + anon key del proyecto **no puede leer ni escribir** datos de negocio directamente desde el navegador o un cliente externo. El backend es el único guardia.

Auth (login/logout) sigue funcionando porque vive en el schema `auth.*`, ajeno a estas políticas.

---

## 5. Vistas SQL

### `v_conciliacion_detalle`

Drill-down completo: una fila por cada vínculo factura↔pago. Incluye datos del emisor, receptor, tipo de pago, banco, número de cheque/referencia, saldos actuales y `url_comprobante`. Usada por `GET /api/facturas/:id` y `GET /api/conciliaciones/reporte`.

### `v_reporte_conciliacion`

Agregada por mes + `tipo_documento` + `estado`. Útil para reportes contables por período.

---

## 6. Parser de Excel SAT (DTE-FEL)

**Archivo:** [backend/utils/excelParser.js](backend/utils/excelParser.js)

### Estructura del Excel SAT (Agencia Virtual)

| Col   | Campo SAT                          | Campo interno              |
|-------|------------------------------------|----------------------------|
| 0     | Fecha de emisión                   | `fecha_emision`            |
| 1     | Número de Autorización             | `numero_autorizacion` (UUID único) |
| 2     | Tipo de DTE (nombre)               | `tipo_dte`                 |
| 3     | Serie                              | `serie`                    |
| 4     | Número del DTE                     | `numero_dte`               |
| 8     | NIT del emisor                     | `nit_emisor`               |
| 9     | Nombre completo del emisor         | `nombre_emisor`            |
| 11    | Nombre del establecimiento         | `nombre_establecimiento`   |
| 12    | ID del receptor                    | `id_receptor` (NIT o `CF`) |
| 13    | Nombre completo del receptor       | `nombre_receptor`          |
| 16    | Estado                             | `estado` (Vigente → pendiente, Anulado → anulada) |
| 17    | Moneda                             | `moneda`                   |
| 18    | Gran Total (Moneda Original)       | `monto_total`              |
| 19    | IVA                                | `monto_iva`                |
| 20    | Marca de anulado                   | `marca_anulado`            |
| 21    | Fecha de anulación                 | `fecha_anulacion`          |
| 22–32 | Impuestos especiales               | `otros_impuestos` (JSONB)  |

### Mapeo dinámico

El SAT cambia el orden/nombre de columnas entre versiones. El parser:
1. Normaliza encabezados (sin acentos, minúsculas, sin espacios).
2. Los compara contra `CAMPO_ALIAS` (múltiples alias por campo).
3. Devuelve `mappingSugerido` con índices de columna.
4. El usuario puede corregirlo en el frontend antes de confirmar.

### Proceso de importación (dos pasos)

```
Paso 1: POST /api/importacion-excel/analizar
        → headers + mappingSugerido + preview (5 filas)
        → El usuario revisa y corrige el mapeo si hace falta

Paso 2: POST /api/importacion-excel/confirmar
        → Inserta en lotes de 100 registros
        → ON CONFLICT (numero_autorizacion) DO NOTHING (deduplicación natural)
        → Registra hash del archivo en importaciones_excel
        → Re-importar el mismo archivo está permitido (puede traer anulaciones nuevas)
```

---

## 7. OCR multimodal con Gemini

**Modelo:** `gemini-3.1-flash-lite` (definido en [backend/index.js:24](backend/index.js#L24)).

### Flujo (`POST /api/process-document`)

1. **Validar entrada** — el frontend manda `imageBase64` + `originalFilename` + `usuario_email`.
2. **Hash MD5** del buffer → busca duplicados en `metodos_pago` (excluyendo `anulado`). Si existe, devuelve el existente sin tocar nada.
3. **Detectar mimeType** desde los primeros bytes (PNG/JPEG/WebP).
4. **Llamar a Gemini** con `temperature=0`, `responseMimeType='application/json'` y un **prompt especializado en Guatemala** (Q, bancos GT, manuscritos cursivos, cruce numérico vs. letras). Captura `tokens_prompt`, `tokens_respuesta`, `tokens_total`.
5. **Limpieza de monto** — quita prefijos `Q.`, normaliza separadores de miles (`.` o `,` seguidos de 3 dígitos) y deja punto decimal.
6. **Parser de fecha** — soporta `YYYY-MM-DD`, `dd/mm/yyyy` y `Guatemala, DD de MES [del] YYYY` con meses en español.
7. **Validación anti-duplicado de cheque** — busca match exacto de `tipo='cheque' + numero_documento + banco + monto_inicial` (excluyendo borradores). Si existe → 500.
8. **Subir a Storage** (`comprobantes`) — solo después de que OCR + validaciones pasaron, para no dejar huérfanos.
9. **Insertar en `metodos_pago`** con estado **`borrador`**. Si la insert falla, hace rollback del archivo en storage.
10. **El usuario confirma** desde el frontend → estado pasa a `disponible`. Si cancela → DELETE en BD + storage.

### Compresión en el cliente

[frontend/src/services/api.js](frontend/src/services/api.js) reescala imágenes > 1.5 MB a JPEG 88% con lado largo máx. 2400 px antes de mandarlas al backend. Esto baja el costo de tokens de imagen y respeta el límite de body de Express (20 MB).

### Costos

Calculados en [backend/routes/admin.js](backend/routes/admin.js) para Gemini 3.1 Flash-Lite:
- Input  (prompt + imagen): **USD 0.50** / millón de tokens
- Output (respuesta JSON):  **USD 3.00** / millón de tokens

`GET /api/admin/token-stats` devuelve totales acumulados, promedio por documento, serie de 7 días y proyección.

---

## 8. Módulo de Scanner (WIA, solo Windows)

**Archivos:**
- [backend/services/scannerService.js](backend/services/scannerService.js) — bridge Node ↔ PowerShell.
- [backend/services/scanner-wia.ps1](backend/services/scanner-wia.ps1) — script WIA.
- [backend/routes/scanner.js](backend/routes/scanner.js) — endpoints + rate limit.
- [frontend/src/components/ScannerCapture.jsx](frontend/src/components/ScannerCapture.jsx) — UI de captura.

### Por qué no aparece en `npm install`

WIA es un componente nativo de Windows. Node interactúa con él vía `execFile('powershell.exe', ['-File', 'scanner-wia.ps1', ...])` y el script PS llama al COM `WIA.DeviceManager`. **No hay paquete npm que reemplace esto** sin perder soporte de drivers reales.

### Seguridad

- `execFile` (no `exec`) → sin shell, sin interpolación.
- Argumentos pasan por flags `-Param value` validados con `[ValidateSet]` y `[ValidateRange]` en PowerShell.
- Validación adicional en Node: `deviceId` no puede contener `\n \r ' " \` ;`.
- Archivos temporales con nombre aleatorio (`crypto.randomBytes(8)`) en `os.tmpdir()`, se borran tras enviarlos.
- Rate limit en memoria: 30 req/min por IP.
- Timeouts: 10 s listar, 120 s escanear.

### Endpoints

| Método | Ruta                       | Descripción                                            |
|--------|----------------------------|--------------------------------------------------------|
| GET    | `/api/scanner/list`        | Devuelve `{count, scanners[{id,name,manufacturer,description}]}` |
| GET    | `/api/scanner/constants`   | DPI range y color modes válidos                        |
| POST   | `/api/scanner/scan`        | Body `{deviceId, dpi?, colorMode?}` → `{base64, mimeType, sizeBytes, dpi, colorMode, filename}` |

### Códigos de error

| `err.code`                   | HTTP | Causa                                                |
|------------------------------|------|------------------------------------------------------|
| `PLATFORM_NOT_SUPPORTED`     | 501  | Sistema operativo ≠ Windows                          |
| `INVALID_DEVICE_ID`          | 400  | DeviceId vacío o con caracteres maliciosos           |
| `INVALID_DPI`                | 400  | DPI fuera de 75–600                                  |
| `INVALID_COLOR_MODE`         | 400  | colorMode no es Color/Grayscale/BW                   |
| `DEVICE_NOT_FOUND`           | 404  | El scanner no está enchufado o WIA no lo reconoce    |
| `TIMEOUT`                    | 504  | El escaneo tardó > 2 min                             |
| `WIA_INIT_FAILED`            | 500  | Servicio `stisvc` detenido o WIA roto                |
| `TRANSFER_FAILED`            | 500  | Error de hardware durante la captura                 |

### Pre-requisitos en el host

- Windows 10/11.
- Driver del scanner instalado (verificar en *Dispositivos e impresoras*).
- Servicio `stisvc` iniciado y en automático.
- `scanner-wia.ps1` accesible en disco (parte del repo, no se descarga aparte).

---

## 9. Estrategia de migración desde v1

Migración [002_migrate_transacciones.sql](backend/migrations/002_migrate_transacciones.sql):
- Cada fila de `transacciones` con `monto > 0` se inserta en `metodos_pago` como `tipo='otro'`, `origen='ocr_upload'`, `estado='disponible'`.
- `notas` guarda el ID original de la transacción para trazabilidad.
- La tabla `transacciones` **no se elimina** — queda con sus datos originales.
- El endpoint legacy `/api/transacciones` ([backend/routes/transacciones.js](backend/routes/transacciones.js)) sigue existiendo para que `Search` y `Viewer` puedan consultar el histórico.

---

## 10. Escenarios de negocio cubiertos

### Cheque cubre múltiples facturas
```
Cheque Q30,000 → Factura A Q12,000 + Factura B Q8,000 + Factura C Q10,000
Resultado: cheque estado=utilizado_total | saldo_disponible=Q0
```

### Factura con pagos parciales
```
Factura Q12,000
  → Cheque Q6,000 → factura estado=parcial, saldo=Q6,000
  → Efectivo Q6,000 → factura estado=pagada, saldo=Q0
```

### Anticipo sin factura asignada
```
Depósito Q5,000 → metodo_pago estado=disponible (sin conciliaciones)
              → saldo_disponible=Q5,000 hasta que se asigne
```

### Nota de crédito aplicada a factura del mismo emisor
```
NCRE Q500 (emisor NIT 1234) → aplicaciones_nota_credito → Factura Q2,000 (mismo NIT)
Trigger: monto_pagado=Q500, estado=parcial. La NCRE queda en estado='nota_credito' (permanente).
```

### Deduplicación de importaciones SAT
```
Misma factura (mismo UUID SAT) en 2 Excels distintos
  → ON CONFLICT (numero_autorizacion) DO NOTHING, ignorado silenciosamente
Reimportar el mismo Excel
  → Permitido: puede traer anulaciones nuevas (estado se actualiza)
```

### Documento OCR cancelado por el usuario
```
Upload → OCR → metodos_pago(estado=borrador) + bucket comprobantes/foo.jpg
Usuario rechaza los datos → DELETE row + remove file from storage
Resultado: ningún rastro, no afecta saldos ni reportes.
```

---

## 11. Endpoints — Resumen completo

```
GET  /api/health

# Facturas
GET    /api/facturas                  ?estado=pendiente&desde=2026-01-01&page=1
GET    /api/facturas/:id              (+ conciliaciones drill-down)
POST   /api/facturas
PATCH  /api/facturas/:id
GET    /api/facturas/reporte/resumen          ?desde=&hasta=
GET    /api/facturas/reporte/control-pagos    ?desde=&hasta=
GET    /api/facturas/sin-relacion/preview
GET    /api/facturas/notas-credito-disponibles?nit_emisores=NIT1,NIT2,...
DELETE /api/facturas/sin-relacion            (requiere confirmación)

# Métodos de Pago
GET    /api/metodos-pago              ?tipo=cheque&estado=disponible
GET    /api/metodos-pago/disponibles
GET    /api/metodos-pago/:id
POST   /api/metodos-pago
PATCH  /api/metodos-pago/:id
POST   /api/metodos-pago/:id/confirmar       (borrador → disponible)
POST   /api/metodos-pago/:id/anular
DELETE /api/metodos-pago/:id

# Conciliaciones
POST   /api/conciliaciones             { factura_id, metodo_pago_id, monto_aplicado }
POST   /api/conciliaciones/batch       (varias a la vez)
POST   /api/conciliaciones/efectivo    (crea efectivo + concilia en un paso)
DELETE /api/conciliaciones/:id         (revertir)
GET    /api/conciliaciones             ?factura_id=&metodo_pago_id=
GET    /api/conciliaciones/reporte     ?desde=&hasta=

# Excel SAT
POST   /api/importacion-excel/analizar  (multipart: excel)
POST   /api/importacion-excel/confirmar (multipart: excel + mapeo JSON + tipo_documento + usuario_email)
GET    /api/importacion-excel/historial
GET    /api/importacion-excel/campos

# OCR — Gemini multimodal
POST   /api/process-document  { imageBase64, originalFilename, usuario_email }

# Scanner WIA (solo Windows)
GET    /api/scanner/list
GET    /api/scanner/constants
POST   /api/scanner/scan       { deviceId, dpi?, colorMode? }

# Métricas
GET    /api/metrics
GET    /api/admin/token-stats
POST   /api/admin/reset-all-data  { confirmacion: 'RESET NEXUS DOC AI', usuario_email }

# Legacy (búsqueda/visualización del histórico v1)
GET    /api/transacciones?q=...
GET    /api/transacciones/:id
PATCH  /api/transacciones/:id
```

---

## 12. Variables de entorno

```bash
# backend/.env
PORT=3000
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<anon-key>                       # fallback opcional
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>  # principal — bypassa RLS
GEMINI_API_KEY=<google-ai-studio-key>

# frontend/.env
VITE_API_URL=http://localhost:3000/api
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Plantillas versionadas:
- [backend/.env.example](backend/.env.example)
- [frontend/.env.example](frontend/.env.example)

---

## 13. Dependencias del backend

```json
{
  "@google/genai":         "Cliente oficial de Gemini API",
  "@supabase/supabase-js": "Cliente Postgres + Storage + Auth",
  "express":               "Servidor HTTP",
  "cors":                  "Middleware CORS",
  "multer":                "Uploads multipart",
  "dotenv":                "Variables de entorno",
  "xlsx":                  "Parser de Excel SAT (.xls/.xlsx/.xlsm)",
  "tesseract.js":          "Vestigio v1 — ya no se usa, pendiente de eliminar"
}
```

> Nota: `tesseract.js` quedó en `package.json` pero el flujo real va por Gemini desde la migración a OCR multimodal. Se puede remover con `npm uninstall tesseract.js` cuando se confirme que ningún script auxiliar lo usa.

## 14. Dependencias del frontend

```json
{
  "react / react-dom":             "UI",
  "react-router-dom":              "Routing SPA",
  "@supabase/supabase-js":         "Auth en el cliente (login)",
  "react-image-crop":              "Recorte de imágenes antes de OCR",
  "exceljs":                       "Pre-parseo de Excel (preview rápido)",
  "lucide-react":                  "Iconografía",
  "recharts":                      "Gráficas en Admin/Dashboard",
  "tailwindcss / clsx / tailwind-merge": "Estilos"
}
```

---

## 15. Notas de operación

- **Limpieza de archivos huérfanos**: `npm run cleanup:storage` (raíz) o `node backend/scripts/cleanup_storage.js`. Borra archivos del bucket `comprobantes` que ya no están referenciados en `metodos_pago.url_comprobante`.
- **Reset total para pruebas**: la página Admin tiene el botón "Eliminar todo" (con frase de confirmación `ELIMINAR TODO`). Internamente llama a `POST /api/admin/reset-all-data` con `{ confirmacion: "RESET NEXUS DOC AI" }`. Vacía conciliaciones, NCRE, métodos de pago, facturas, importaciones, transacciones y el bucket.
- **Build de producción**: `cd frontend && npm run build` → `frontend/dist/`. Hay un `frontend/vercel.json` para deploy directo. El backend puede ir a Render/Railway/Fly o cualquier host Node.
- **Migraciones futuras**: añadir nuevos archivos `00X_*.sql` en `backend/migrations/`. La migración 001 ya es **consolidada** (incluye 001–011), así que un proyecto nuevo solo necesita correrla una vez.

---

*Documentación técnica para v2.1. Actualizada con: Gemini 3.1 Flash-Lite como OCR, módulo Scanner WIA, RLS estricta, soporte de notas de crédito, auditoría de tokens y estado borrador.*
