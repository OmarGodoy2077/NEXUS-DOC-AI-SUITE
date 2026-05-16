# Frontend Technical Documentation — NEXUS DOC AI SUITE v2.1

SPA en React 18 + Vite + Tailwind. Documentación técnica del cliente. Para visión global y backend ver [../TECHNICAL_DOCUMENTATION.md](../TECHNICAL_DOCUMENTATION.md).

---

## 1. Stack

| Categoría        | Librería                          | Uso                                                  |
|------------------|-----------------------------------|------------------------------------------------------|
| Framework        | **React 18**                      | UI                                                   |
| Build            | **Vite 5**                        | Dev server + bundling                                |
| Routing          | **react-router-dom 6**            | Rutas SPA                                            |
| Estilos          | **TailwindCSS 3** + `clsx` + `tailwind-merge` | Utility-first + composición       |
| Auth             | **@supabase/supabase-js**         | Solo login/logout (sin acceso a datos de negocio)    |
| Iconos           | **lucide-react**                  | Iconografía consistente                              |
| Gráficas         | **recharts**                      | Dashboard / Admin                                    |
| Excel            | **exceljs**                       | Preview rápido en el cliente (opcional)              |
| Image crop       | **react-image-crop**              | Recorte previo al OCR                                |
| HTTP             | **fetch** nativo                  | `src/services/api.js`                                |

---

## 2. Estructura de archivos

```
frontend/
├── index.html
├── vite.config.js          # Dev server en 5173, headers no-cache para hot reload limpio
├── tailwind.config.js
├── postcss.config.js
├── vercel.json             # SPA rewrite para deploy estático
├── .env / .env.example
└── src/
    ├── main.jsx
    ├── App.jsx             # Rutas
    ├── index.css           # Tailwind base
    ├── components/
    │   ├── ImageCropper.jsx
    │   ├── ScannerCapture.jsx          # ← Integración con /api/scanner
    │   ├── finance/
    │   │   ├── DrillDownModal.jsx
    │   │   ├── EstadoBadge.jsx
    │   │   └── PeriodFilter.jsx
    │   ├── layout/
    │   │   ├── Header.jsx
    │   │   ├── Layout.jsx
    │   │   └── Sidebar.jsx
    │   └── ui/
    │       ├── Badge.jsx
    │       ├── Button.jsx
    │       ├── Card.jsx
    │       ├── LoadingSpinner.jsx
    │       └── Modal.jsx
    ├── context/
    │   └── AppContext.jsx              # Auth + notificaciones globales
    ├── pages/
    │   ├── Login.jsx                   # Supabase Auth (signInWithPassword)
    │   ├── Dashboard.jsx
    │   ├── Facturas.jsx
    │   ├── MetodosPago.jsx
    │   ├── Conciliacion.jsx
    │   ├── ImportarExcel.jsx
    │   ├── Upload.jsx                  # Drag&drop + Scanner + Cropper + OCR
    │   ├── Processing.jsx
    │   ├── Admin.jsx                   # Métricas, tokens, costos, reset
    │   ├── Search.jsx
    │   └── Viewer.jsx
    ├── services/
    │   ├── api.js                      # Todos los fetch al backend
    │   └── mockAPI.js
    └── data/
        └── mockData.json
```

---

## 3. Rutas

Definidas en [src/App.jsx](src/App.jsx):

| Path                | Componente       | Notas                                 |
|---------------------|------------------|---------------------------------------|
| `/`                 | `Login`          | Pública                               |
| `/dashboard`        | `Dashboard`      | Layout principal                      |
| `/facturas`         | `Facturas`       | Lista + filtros + drill-down          |
| `/metodos-pago`     | `MetodosPago`    | Cheques/transferencias/efectivo       |
| `/conciliacion`     | `Conciliacion`   | UI de matching N:M                    |
| `/importar-excel`   | `ImportarExcel`  | 2-step Excel SAT                      |
| `/upload`           | `Upload`         | OCR (file/drag&drop/scanner) + crop   |
| `/admin`            | `Admin`          | Métricas + tokens + costos + reset    |
| `*`                 | → `/`            | Catch-all                             |

`Layout` envuelve todas las rutas autenticadas con Sidebar + Header.

---

## 4. Autenticación

[`AppContext.jsx`](src/context/AppContext.jsx):
- Crea **un único** cliente Supabase con `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`.
- Suscribe a `onAuthStateChange` para sincronizar `user`.
- Expone `signOut`, `showNotification`, `user`, `supabase` por contexto.

Los componentes **nunca** consultan tablas de Supabase directamente — la RLS los bloquearía. Todas las queries van por `services/api.js` al backend.

`Login.jsx` usa `supabase.auth.signInWithPassword({ email, password })`.

---

## 5. Capa de servicios — `src/services/api.js`

Wrappers tipados (sin TypeScript, pero con shape consistente) por dominio:

| Export                  | Endpoints cubiertos                                                        |
|-------------------------|----------------------------------------------------------------------------|
| `api.processDocument`   | `POST /api/process-document` (OCR Gemini)                                  |
| `compressImageForOCR`   | Cliente: recomprime PNG/JPEG/WebP > 1.5 MB a JPEG 88% / max 2400 px        |
| `facturasAPI`           | list / get / create / update / resumen / control-pagos / notas-credito / sin-relacion |
| `pagosAPI`              | list / disponibles / get / create / update / confirmar / anular / delete   |
| `conciliacionesAPI`     | crear / batch / efectivo / revertir / list / reporte                       |
| `excelAPI`              | analizar / confirmar / historial / campos                                  |
| `metricsAPI`            | get                                                                        |
| `scannerAPI`            | list / constants / scan                                                    |
| `transaccionesAPI`      | search / get / update (legacy v1)                                          |
| `adminAPI`              | resetAllData / tokenStats                                                  |

Todas usan `fetch(BASE + path, ...)` con `Content-Type: application/json`, parsean JSON y arrojan `Error(json.error)` si `!res.ok`.

### Compresión de imagen antes del OCR

Antes de mandar la imagen al backend, `compressImageForOCR`:
1. Calcula tamaño aproximado base64.
2. Si < 1.5 MB → pasa tal cual.
3. Si > 1.5 MB → carga en `<img>`, dibuja en `<canvas>` reescalando lado largo a 2400 px, exporta `image/jpeg` calidad 0.88.

Esto baja tokens de imagen en Gemini sin perder legibilidad de cheques manuscritos.

---

## 6. Captura desde scanner físico

[`ScannerCapture.jsx`](src/components/ScannerCapture.jsx):
1. `scannerAPI.list()` al montar → llena el dropdown de dispositivos.
2. Auto-selecciona el primero.
3. Controles para DPI (75–600) y modo de color (Color/Grayscale/BW).
4. `scannerAPI.scan({ deviceId, dpi, colorMode })` → preview + callback `onScanComplete({ imageBase64, originalFilename })`.

Errores comunes que el componente debe mostrar al usuario:
- `PLATFORM_NOT_SUPPORTED` → "Solo Windows soporta el scanner físico. Usa upload manual."
- `DEVICE_NOT_FOUND` → "El scanner no está conectado."
- `TIMEOUT` → "El scanner tardó demasiado, intenta de nuevo."

Se integra en `Upload.jsx` como una pestaña/sección paralela al drag&drop.

---

## 7. Flujos clave

### 7.1 Subir + OCR (`Upload.jsx`)

```
[Drag&Drop file] ─┐
                  ├─► imageBase64 → compressImageForOCR
[Scanner WIA] ────┤   → ImageCropper (opcional) → api.processDocument
                  │   → mostrar resultado en pantalla
[Camera/paste] ───┘   → usuario confirma o cancela
                      → confirmar: pagosAPI.confirmar(id) → estado=disponible
                      → cancelar:  pagosAPI.delete(id)    → rollback BD + storage
```

### 7.2 Importar SAT (`ImportarExcel.jsx`)

```
Paso 1: <input type="file"> → excelAPI.analizar(file)
        → render preview + form de mapeo editable
Paso 2: usuario confirma → excelAPI.confirmar(file, mapeo, tipo_documento, usuario_email)
        → toast con { insertadas, duplicadas, errores }
```

### 7.3 Conciliación (`Conciliacion.jsx`)

```
Cargar facturas estado in (pendiente, parcial)
Cargar metodos_pago estado in (disponible, utilizado_parcial)
Usuario selecciona factura + método + monto
Validar: monto <= min(saldo_pendiente, saldo_disponible)
conciliacionesAPI.crear({ factura_id, metodo_pago_id, monto_aplicado })
Refetch ambas listas → la UI refleja los nuevos saldos/estados (calculados por triggers)
```

### 7.4 Admin (`Admin.jsx`)

- `adminAPI.tokenStats()` → KPIs de tokens, costo USD, serie 7 días, proyección por documentos/mes.
- `adminAPI.resetAllData(usuario_email)` con modal de confirmación que exige escribir `ELIMINAR TODO`. Internamente manda `{ confirmacion: 'RESET NEXUS DOC AI' }`.

---

## 8. Estado y datos

Hoy el estado es **local + Context**. Patrón típico por página:
- `useState` para lista, filtros, modal abierto.
- `useEffect` para fetch inicial (sin react-query — fetch + estado plano).
- Refresco manual tras mutaciones (`await crearX(); await refetchList();`).

Para crecer, evaluar **TanStack Query** (cache, refetch automático, invalidación) en endpoints donde el refresh manual se vuelve frágil (Conciliacion, Admin con polling de stats).

---

## 9. Estilos

- **Tailwind** con tema mínimo en [tailwind.config.js](tailwind.config.js) (paleta tipo Apple: `apple-bg`, `apple-text`, `apple-accent`, `apple-border`).
- **`clsx` + `tailwind-merge`** para componer clases dinámicas sin colisiones.
- Componentes UI base en `components/ui/` reutilizan los mismos tokens.

---

## 10. Variables de entorno

`frontend/.env` (plantilla en [.env.example](.env.example)):

```env
VITE_API_URL=http://localhost:3000/api
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

Todas las variables expuestas al cliente **deben** prefijarse con `VITE_` para que Vite las inyecte.

---

## 11. Build y deploy

```bash
cd frontend
npm run build       # → frontend/dist/
npm run preview     # sirve dist localmente
```

`frontend/vercel.json` está preparado para deploy en Vercel:
```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
```

En producción debes:
1. Apuntar `VITE_API_URL` al backend desplegado (HTTPS).
2. Asegurar que el backend permita CORS desde el dominio del frontend (hoy usa `cors()` sin restricción).
3. Para usar el scanner WIA en producción, el backend debe correr en Windows + tener acceso al hardware. Si el backend está en Linux/contenedores, el endpoint devolverá 501 y la UI debe mostrarlo de manera amigable.

---

## 12. Buenas prácticas pendientes (roadmap)

- **TanStack Query** para data fetching (caché, refetch, dedupe).
- **React Hook Form + Zod** para formularios complejos (conciliación, mapeo Excel).
- **Tests**: Vitest + React Testing Library para hooks/componentes; Playwright para E2E del flujo OCR + conciliación.
- **Code splitting**: las páginas más pesadas (`Admin` con recharts) se beneficiarían de `lazy()` + `Suspense`.
- **Tipado**: migrar a TypeScript reduce errores entre `services/api.js` y los componentes consumidores.

---

*Documentación frontend v2.1 — sincronizada con scanner WIA, OCR Gemini y endpoints actualizados (`/api/admin/*`, `/api/conciliaciones/efectivo`, `/api/facturas/sin-relacion`, etc.).*
