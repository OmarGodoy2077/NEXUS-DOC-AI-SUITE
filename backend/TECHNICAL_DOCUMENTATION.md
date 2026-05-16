# Backend Technical Documentation — NEXUS DOC AI SUITE v2.1

Resumen técnico del backend Node.js + Express. Para el modelo de datos completo (triggers, vistas, RLS) consulta [../TECHNICAL_DOCUMENTATION.md](../TECHNICAL_DOCUMENTATION.md).

---

## 1. Arquitectura

Aplicación Node.js (Express 5) que orquesta:
- **OCR multimodal** con Google **Gemini 3.1 Flash-Lite** sobre cheques, transferencias y depósitos.
- **Importación SAT DTE-FEL** en dos pasos (analizar → confirmar) con deduplicación por `numero_autorizacion`.
- **Conciliación N:M** entre facturas y métodos de pago, delegada al motor PostgreSQL vía triggers.
- **Captura desde scanner físico** vía WIA (Windows) — única ruta del sistema que sale del proceso Node.
- **Auditoría de costos de IA** (tokens prompt/respuesta/total + modelo por documento).
- **Reset/limpieza** para pruebas y mantenimiento del storage.

```
index.js  ─┐
           ├─► routes/facturas.js          (facturas + reportes + notas crédito disponibles)
           ├─► routes/metodosPago.js       (métodos de pago, confirmar/anular)
           ├─► routes/conciliaciones.js    (single, batch, efectivo, revertir, reporte)
           ├─► routes/importacionExcel.js  (analizar, confirmar, historial, campos)
           ├─► routes/admin.js             (token-stats, reset-all-data)
           ├─► routes/scanner.js  ──► services/scannerService.js ──► services/scanner-wia.ps1 (Windows)
           ├─► routes/transacciones.js     (legacy v1)
           ├─► utils/excelParser.js        (parser DTE-FEL)
           └─► /api/process-document       (OCR Gemini — inline en index.js)
```

### Componentes principales

- **`index.js`** — Bootstrap de Express, middleware, routers, OCR con Gemini, `/api/health`, `/api/metrics`.
- **Middleware** — `cors`, `express.json({ limit: '20mb' })` (para imágenes base64), `multer.memoryStorage()` para uploads.
- **Supabase client** — Singleton inicializado con `SUPABASE_SERVICE_ROLE_KEY` (fallback a `SUPABASE_KEY`). Bypassa RLS por diseño.
- **Gemini client** — `@google/genai`, modelo `gemini-3.1-flash-lite`, `temperature=0`, `responseMimeType='application/json'`.

---

## 2. Modelo de datos (resumen)

| Tabla                          | Rol                                                                                  |
|--------------------------------|--------------------------------------------------------------------------------------|
| `facturas`                     | DTE-FEL del SAT y documentos OCR. `saldo_pendiente` GENERATED, estado por trigger.   |
| `metodos_pago`                 | Cheques, transferencias, depósitos, efectivo, anticipos. `saldo_disponible` GENERATED. |
| `conciliaciones`               | Pivot N:M factura↔pago. Cada fila dispara recálculo en ambos lados.                  |
| `aplicaciones_nota_credito`    | NCRE aplicada a facturas del mismo emisor.                                            |
| `importaciones_excel`          | Histórico de archivos SAT importados con su mapeo.                                    |
| `transacciones`                | Tabla legacy v1, preservada solo para histórico/búsqueda.                             |

**Vistas:** `v_conciliacion_detalle`, `v_reporte_conciliacion`.

**Triggers críticos:**
- `trg_actualizar_factura` (AFTER INS/UPD/DEL `conciliaciones`)
- `trg_recalcular_factura_por_nc` (AFTER INS/UPD/DEL `aplicaciones_nota_credito`)
- `trg_actualizar_metodo_pago` (AFTER INS/UPD/DEL `conciliaciones`)
- `trg_facturas_updated_at`, `trg_metodos_pago_updated_at`

**RLS:** policy `deny_anon_auth` (`USING(false) WITH CHECK(false)`) en todas las tablas de negocio. Solo `service_role` accede.

Detalles completos: [../TECHNICAL_DOCUMENTATION.md §1–§5](../TECHNICAL_DOCUMENTATION.md).

---

## 3. Flujos clave

### 3.1 OCR — `POST /api/process-document`

1. Recibir `imageBase64 + originalFilename + usuario_email`.
2. MD5 del buffer → buscar duplicado activo (excluyendo `anulado`). Si existe, devolver tal cual sin nuevo OCR.
3. Detectar mimeType desde primeros bytes (PNG/JPEG/WebP).
4. **Gemini call** con prompt especializado en Guatemala (Q, bancos GT, manuscritos cursivos, cruce numérico↔letras). Captura `usageMetadata` para auditoría.
5. Sanitizar `monto` (quitar `Q.`, normalizar separadores miles/decimal).
6. Parsear fecha (`YYYY-MM-DD`, `dd/mm/yyyy`, o "Guatemala, DD de MES YYYY" en español). Si falla, **error** (no se crea el registro).
7. Truncar y normalizar `numero_documento` y `banco`.
8. Si `tipo='cheque'` y hay banco+número+monto → verificar duplicado por combinación exacta. Si existe → 500.
9. **Subir a Storage** `comprobantes/<timestamp>_<filename-sanitizado>`. Solo después de pasar todas las validaciones, para no dejar huérfanos.
10. Insertar en `metodos_pago` con `estado='borrador'`. Si la insert falla, hacer rollback del archivo (`storage.remove`).
11. Devolver el registro al cliente.

El cliente luego llama `POST /api/metodos-pago/:id/confirmar` para pasarlo a `disponible`, o `DELETE /api/metodos-pago/:id` para cancelar (que limpia BD + storage).

### 3.2 Importación SAT — dos pasos

`POST /api/importacion-excel/analizar` (multipart):
- Carga el Excel con `xlsx`.
- Normaliza encabezados, sugiere mapeo basado en alias.
- Devuelve `headers + mappingSugerido + preview` (sin `rawData`).

`POST /api/importacion-excel/confirmar` (multipart):
- Recibe el archivo de nuevo + mapeo final + `tipo_documento` + `usuario_email`.
- Inserta en lotes de 100 filas usando `ON CONFLICT (numero_autorizacion) DO NOTHING`.
- Registra hash y mapeo en `importaciones_excel`.

> Re-importar el mismo Excel está permitido: trae anulaciones nuevas (actualiza `estado` y `marca_anulado`).

### 3.3 Conciliación

`POST /api/conciliaciones { factura_id, metodo_pago_id, monto_aplicado }`:
- Inserta una fila → triggers actualizan ambos lados automáticamente.

`DELETE /api/conciliaciones/:id`:
- Borra la fila → triggers revierten saldos y estados.

`POST /api/conciliaciones/batch`: varias conciliaciones en una sola request.
`POST /api/conciliaciones/efectivo`: crea un `metodos_pago` tipo=`efectivo` y lo concilia atómicamente.

### 3.4 Scanner WIA — `routes/scanner.js`

| Método | Ruta                     | Notas                                              |
|--------|--------------------------|----------------------------------------------------|
| GET    | `/api/scanner/list`      | Lista scanners detectados por WIA                  |
| GET    | `/api/scanner/constants` | DPI range y color modes válidos para la UI         |
| POST   | `/api/scanner/scan`      | Body `{deviceId, dpi=200, colorMode='Color'}`      |

`scannerService.js`:
- `execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scanner-wia.ps1, ...flags])`.
- Sin shell → no inyección.
- Validación de `deviceId` (no permite `\n \r ' " \` ;`).
- `dpi` ∈ [75, 600], `colorMode` ∈ {Color, Grayscale, BW}.
- Timeouts: 10 s listar, 120 s escanear. Rate limit en memoria 30 req/min/IP.
- Archivo temporal con nombre aleatorio en `os.tmpdir()`, se borra en `finally`.

`scanner-wia.ps1`:
- COM `WIA.DeviceManager` → enumera dispositivos tipo Scanner (`Type=1`).
- En `scan`: setea propiedades `6146=intent`, `6147/6148=DPI`, transfiere como JPEG (`{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}`), guarda en `OutputPath`, devuelve metadata como JSON por stdout.

**Plataforma no soportada** (macOS/Linux) → endpoint devuelve **501** con `code: 'PLATFORM_NOT_SUPPORTED'`. El frontend muestra un mensaje claro y permite el flujo manual.

### 3.5 Admin

- `GET /api/admin/token-stats` — promedios y costos en USD (`input $0.50 / output $3.00` por millón).
- `POST /api/admin/reset-all-data { confirmacion: 'RESET NEXUS DOC AI', usuario_email }` — vacía conciliaciones, NCRE, métodos_pago, facturas, importaciones, transacciones y el bucket `comprobantes`. Orden por FK RESTRICT.

---

## 4. Configuración inicial

Variables de entorno mínimas (`backend/.env`):

```env
PORT=3000
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
GEMINI_API_KEY=<google-ai-studio-key>
```

Plantilla: [.env.example](./.env.example).

**Setup completo:** ver [README §Instalación](../README.md#instalación-rápida-recomendada).

---

## 5. Consideraciones de seguridad

1. **`SUPABASE_SERVICE_ROLE_KEY`** equivale a admin de Postgres. Nunca llega al navegador.
2. **RLS estricta** en BD asegura que aunque la anon key se filtre, no se pueden leer facturas/pagos.
3. **`/api/admin/*`** debería protegerse con un middleware de autenticación de admin (pendiente — actualmente cualquier cliente que llegue al backend puede invocarlo). Recomendado: validar `usuario_email` contra una lista o exigir un JWT de Supabase con rol admin.
4. **Scanner**: `execFile` sin shell, validación estricta de `deviceId`, archivos temporales con nombres aleatorios. Riesgo limitado a la propia máquina (WIA es local).
5. **Storage**: bucket `comprobantes` es privado; las URLs públicas que se guardan en `metodos_pago.url_comprobante` provienen de `getPublicUrl` (RPC firmada por service_role).
6. **Validación de archivos**: el Excel tiene límite 10 MB. La imagen OCR está limitada por `express.json({ limit: '20mb' })`. El frontend recomprime > 1.5 MB a JPEG 88% / max 2400 px.

---

## 6. Escalado

1. **Procesamiento asíncrono** — Para Excels grandes o picos de OCR, mover a job queue (BullMQ + Redis). Devolver `{ jobId }` y exponer `GET /api/jobs/:id` para polling.
2. **Performance de BD** — `conciliaciones` crece rápido. Índices ya creados: `factura_id`, `metodo_pago_id`, `fecha_conciliacion`. Para datasets > 1M filas, particionar por año.
3. **Multi-tenant** — Hoy todos los datos viven en el mismo esquema. Para SaaS multi-org, añadir `org_id` en todas las tablas y políticas RLS por org (entonces el backend usaría anon + JWT en vez de service_role).
4. **Costo de IA** — La página Admin ya muestra costo acumulado y proyección. Si crece mucho, considerar Gemini Flash (más barato pero menos preciso) o un modelo local (Ollama + MiniCPM-V) como fallback en bulk imports.
5. **Containerización** — Backend listo para `Dockerfile` simple (Node 18-alpine + `npm ci`). El scanner WIA **no funciona en contenedores Linux**; si necesitas scanner en producción, el host debe ser Windows.

---

## 7. Mantenimiento

- **Limpieza de huérfanos**: `node backend/scripts/cleanup_storage.js` (o `npm run cleanup:storage` desde la raíz). Compara `metodos_pago.url_comprobante` activos vs. archivos en el bucket y borra los sobrantes en lotes de 20.
- **Logs**: `console.log/error` a stdout. Para producción, redirigir a un agregador (Sentry, Logtail, Loki). El OCR loguea tokens y modelo en cada llamada.
- **Health**: `GET /api/health` devuelve versión + módulos activos.

---

*Documentación backend v2.1. Sincronizada con Gemini 3.1 Flash-Lite, scanner WIA, migración consolidada 001 (RLS, NCRE, tokens, borrador).*
