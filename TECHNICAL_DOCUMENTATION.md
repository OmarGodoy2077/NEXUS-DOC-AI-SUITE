# NEXUS DOC AI SUITE — Documentación Técnica v2.0

---

## 1. Análisis del Modelo de Datos

### Por qué este diseño

El requerimiento central es la relación **N:M flexible** entre facturas y métodos de pago con control de saldos parciales. El diseño se basa en tres entidades independientes conectadas por una tabla pivot:

```
facturas ──────────── conciliaciones ──────────── metodos_pago
(DTE-FEL / OCR)       (tabla pivot N:M)           (cheques, transferencias)
                       monto_aplicado              monto_inicial
                                                   saldo_utilizado (calculado)
```

**Decisiones clave:**
- `saldo_pendiente` en `facturas` y `saldo_disponible` en `metodos_pago` son columnas **GENERATED** (calculadas en PostgreSQL), nunca escritas directamente por la aplicación.
- Los estados (`pendiente → parcial → pagada`) se actualizan **automáticamente** mediante triggers AFTER INSERT/UPDATE/DELETE en `conciliaciones`. Esto garantiza consistencia incluso si hay múltiples clientes o inserciones directas en la BD.
- `numero_autorizacion` en `facturas` tiene constraint UNIQUE para soportar el `ON CONFLICT DO NOTHING` durante importaciones masivas SAT (deduplicación natural).

---

## 2. Diagrama de Tablas (ERD textual)

```
┌─────────────────────────────────────────────────────────┐
│                        facturas                         │
├─────────────────────────────────────────────────────────┤
│ id                UUID PK                               │
│ numero_autorizacion TEXT UNIQUE  ← UUID del SAT         │
│ tipo_dte           VARCHAR(20)   ← FPEQ, FACT, etc.     │
│ serie              VARCHAR(50)                          │
│ numero_dte         VARCHAR(50)                          │
│ fecha_emision      TIMESTAMPTZ                          │
│ nit_emisor         VARCHAR(20)                          │
│ nombre_emisor      TEXT                                 │
│ id_receptor        VARCHAR(20)   ← NIT o 'CF'           │
│ nombre_receptor    TEXT                                 │
│ moneda             VARCHAR(5)    DEFAULT 'GTQ'          │
│ monto_total        DECIMAL(15,2) NOT NULL               │
│ monto_iva          DECIMAL(15,2)                        │
│ otros_impuestos    JSONB         ← impuestos especiales │
│ monto_pagado       DECIMAL(15,2) ← actualizado x trigger│
│ saldo_pendiente    DECIMAL GENERATED (total - pagado)   │
│ estado             ENUM(pendiente|parcial|pagada|anulada)│
│ tipo_documento     ENUM(compra|venta|nota_credito|...)  │
│ origen             ENUM(sat_excel|ocr_upload|manual)    │
│ marca_anulado      BOOLEAN                              │
│ url_archivo        TEXT                                 │
│ raw_ocr            TEXT                                 │
│ file_hash          TEXT                                 │
│ usuario_creacion   TEXT                                 │
│ created_at / updated_at  TIMESTAMPTZ                   │
└───────────────────────┬─────────────────────────────────┘
                        │ 1
                        │
                        │ N
┌───────────────────────┴─────────────────────────────────┐
│                     conciliaciones                      │
├─────────────────────────────────────────────────────────┤
│ id                  UUID PK                             │
│ factura_id          UUID FK → facturas.id               │
│ metodo_pago_id      UUID FK → metodos_pago.id           │
│ monto_aplicado      DECIMAL(15,2) CHECK > 0             │
│ fecha_conciliacion  DATE                                │
│ usuario_conciliacion TEXT                               │
│ notas               TEXT                                │
│ created_at          TIMESTAMPTZ                         │
└───────────────────────┬─────────────────────────────────┘
                        │ N
                        │
                        │ 1
┌───────────────────────┴─────────────────────────────────┐
│                     metodos_pago                        │
├─────────────────────────────────────────────────────────┤
│ id               UUID PK                                │
│ tipo             ENUM(cheque|transferencia|deposito|...) │
│ banco            VARCHAR(100)                           │
│ numero_documento VARCHAR(100)  ← No. cheque / referencia│
│ fecha_documento  DATE NOT NULL                          │
│ monto_inicial    DECIMAL(15,2) CHECK > 0                │
│ saldo_utilizado  DECIMAL(15,2) ← actualizado x trigger  │
│ saldo_disponible DECIMAL GENERATED (inicial - utilizado)│
│ estado           ENUM(disponible|utilizado_parcial|...)  │
│ descripcion      TEXT          ← beneficiario OCR       │
│ url_comprobante  TEXT                                   │
│ file_hash        TEXT                                   │
│ raw_ocr          TEXT                                   │
│ origen           ENUM(sat_excel|ocr_upload|manual)      │
│ usuario_creacion TEXT                                   │
│ created_at / updated_at  TIMESTAMPTZ                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                  importaciones_excel                    │
├─────────────────────────────────────────────────────────┤
│ id                  UUID PK                             │
│ nombre_archivo      TEXT                                │
│ file_hash           TEXT UNIQUE  ← previene reimportar  │
│ total_filas         INT                                 │
│ filas_importadas    INT                                 │
│ filas_duplicadas    INT                                 │
│ filas_error         INT                                 │
│ mapeo_columnas      JSONB  ← mapeo usado                │
│ periodo_desde/hasta DATE                                │
│ estado_importacion  VARCHAR                             │
│ errores_detalle     JSONB                               │
│ usuario_importacion TEXT                                │
│ created_at          TIMESTAMPTZ                         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Triggers y Lógica Automática

### `trg_actualizar_factura` (AFTER INSERT/UPDATE/DELETE en conciliaciones)

Recalcula `monto_pagado` y `estado` de la factura afectada:

```
monto_pagado = SUM(conciliaciones.monto_aplicado) WHERE factura_id = X
saldo_pendiente = monto_total - monto_pagado  ← columna GENERATED

si monto_pagado = 0         → estado = 'pendiente'
si monto_pagado < monto_total → estado = 'parcial'
si monto_pagado >= monto_total → estado = 'pagada'
(facturas 'anuladas' no se tocan)
```

### `trg_actualizar_metodo_pago` (AFTER INSERT/UPDATE/DELETE en conciliaciones)

Recalcula `saldo_utilizado` y `estado` del método de pago:

```
saldo_utilizado = SUM(conciliaciones.monto_aplicado) WHERE metodo_pago_id = X
saldo_disponible = monto_inicial - saldo_utilizado  ← columna GENERATED

si saldo_utilizado = 0              → estado = 'disponible'
si saldo_utilizado < monto_inicial  → estado = 'utilizado_parcial'
si saldo_utilizado >= monto_inicial → estado = 'utilizado_total'

RAISE EXCEPTION si saldo_utilizado > monto_inicial  ← protección de integridad
```

---

## 4. Vistas SQL

### `v_conciliacion_detalle`
Drill-down completo: una fila por cada vinculación factura↔pago. Incluye datos del emisor, receptor, tipo de pago, banco, número de cheque/referencia y saldos actuales. Usada por `GET /api/facturas/:id` y `GET /api/conciliaciones/reporte`.

### `v_reporte_conciliacion`
Agrupada por mes + tipo_documento + estado. Útil para reportes contables por período.

---

## 5. Parser de Excel SAT (DTE-FEL)

**Archivo:** [backend/utils/excelParser.js](backend/utils/excelParser.js)

### Estructura del Excel SAT (Agencia Virtual)

| Col | Campo SAT | Campo interno |
|-----|-----------|---------------|
| 0 | Fecha de emisión | `fecha_emision` |
| 1 | Número de Autorización | `numero_autorizacion` (UUID único) |
| 2 | Tipo de DTE (nombre) | `tipo_dte` |
| 3 | Serie | `serie` |
| 4 | Número del DTE | `numero_dte` |
| 8 | NIT del emisor | `nit_emisor` |
| 9 | Nombre completo del emisor | `nombre_emisor` |
| 11 | Nombre del establecimiento | `nombre_establecimiento` |
| 12 | ID del receptor | `id_receptor` (NIT o 'CF') |
| 13 | Nombre completo del receptor | `nombre_receptor` |
| 16 | Estado | `estado` (Vigente → pendiente, Anulado → anulada) |
| 17 | Moneda | `moneda` |
| 18 | Gran Total (Moneda Original) | `monto_total` |
| 19 | IVA | `monto_iva` |
| 20 | Marca de anulado | `marca_anulado` |
| 21 | Fecha de anulación | `fecha_anulacion` |
| 22–32 | Impuestos especiales | `otros_impuestos` (JSONB) |

### Mapeo dinámico

El SAT cambia el nombre/orden de columnas entre versiones. El parser:
1. Normaliza los encabezados (quita acentos, minúsculas, espacios)
2. Compara contra el catálogo `CAMPO_ALIAS` (múltiples alias por campo)
3. Devuelve un `mappingSugerido` con índices de columna
4. El usuario puede corregir el mapeo en el frontend antes de confirmar

### Proceso de importación (2 pasos)

```
Paso 1: POST /api/importacion-excel/analizar
        → Devuelve headers + mappingSugerido + preview
        → El usuario revisa y corrige el mapeo si es necesario

Paso 2: POST /api/importacion-excel/confirmar  
        → Inserta en lotes de 100 registros
        → ON CONFLICT (numero_autorizacion) DO NOTHING (deduplicación)
        → Registra en importaciones_excel con hash del archivo
        → Un mismo archivo no puede reimportarse (hash único)
```

---

## 6. Estrategia de Migración desde v1

Los datos de la tabla `transacciones` (v1) se migran a `metodos_pago` con:
- `tipo = 'otro'`
- `origen = 'ocr_upload'`
- `estado = 'disponible'`
- `notas` contiene el ID original para trazabilidad

La tabla `transacciones` se **preserva** en producción — no se elimina. La migración es no destructiva.

---

## 7. Escenarios de Negocio Cubiertos

### Cheque cubre múltiples facturas
```
Cheque Q30,000 → Factura A Q12,000 + Factura B Q8,000 + Factura C Q10,000
Resultado: Cheque estado=utilizado_total | saldo_disponible=0
```

### Factura con pago parcial + segundo pago
```
Factura Q12,000
  → Cheque Q6,000 → factura estado=parcial, saldo=Q6,000
  → Efectivo Q6,000 → factura estado=pagada, saldo=Q0
```

### Anticipo sin factura asignada
```
Depósito Q5,000 → metodo_pago con estado=disponible
(sin conciliaciones) → saldo_disponible=Q5,000 hasta asignarse
```

### Deduplicación de importaciones
```
Excel importado por 2da vez → 409 Conflict + referencia a importación previa
Misma factura (mismo UUID SAT) en 2 Excels → ON CONFLICT ignorado silenciosamente
```

---

## 8. Endpoints de la API — Resumen completo

```
GET  /api/health

# Facturas
GET    /api/facturas                    ?estado=pendiente&desde=2026-01-01&page=1
GET    /api/facturas/:id                (+ conciliaciones drill-down)
POST   /api/facturas
PATCH  /api/facturas/:id
GET    /api/facturas/reporte/resumen    ?desde=&hasta=

# Métodos de Pago
GET    /api/metodos-pago                ?tipo=cheque&estado=disponible
GET    /api/metodos-pago/disponibles
GET    /api/metodos-pago/:id
POST   /api/metodos-pago
PATCH  /api/metodos-pago/:id
POST   /api/metodos-pago/:id/anular

# Conciliaciones
POST   /api/conciliaciones              { factura_id, metodo_pago_id, monto_aplicado }
DELETE /api/conciliaciones/:id          (revertir)
GET    /api/conciliaciones              ?factura_id=&metodo_pago_id=
GET    /api/conciliaciones/reporte      ?desde=&hasta=

# Excel SAT
POST   /api/importacion-excel/analizar  (multipart: excel)
POST   /api/importacion-excel/confirmar (multipart: excel + mapeo JSON)
GET    /api/importacion-excel/historial
GET    /api/importacion-excel/campos

# OCR (preservado v1)
POST   /api/process-document            (multipart: document + usuario_email)

# Métricas
GET    /api/metrics
```

---

## 9. Variables de Entorno

```bash
# backend/.env
PORT=3000
SUPABASE_URL=https://bgmluvskygcwtabytbdc.supabase.co
SUPABASE_KEY=<service-role-key>

# frontend/.env
VITE_SUPABASE_URL=https://bgmluvskygcwtabytbdc.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
VITE_API_URL=http://localhost:3000/api
```

---

## 10. Dependencias del Backend

```json
{
  "express": "servidor HTTP",
  "cors": "CORS middleware",
  "multer": "upload de archivos",
  "@supabase/supabase-js": "cliente de Supabase",
  "dotenv": "variables de entorno",
  "xlsx": "lectura de archivos Excel SAT"
}
```

**Nota:** `tesseract.js` ha sido eliminado en favor de un modelo de IA multimodal local más preciso (MiniCPM-V vía Ollama).

Para instalar `xlsx`:
```bash
cd backend && npm install xlsx
```
