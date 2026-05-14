const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

const headers = {
  'Content-Type': 'application/json',
};

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { ...headers, ...options.headers },
    ...options,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
  return json;
}

export const api = {
  processDocument: async ({ imageBase64, originalFilename, usuario_email }) => {
    const response = await fetch(`${BASE}/process-document`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ imageBase64, originalFilename, usuario_email }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error al procesar con LLaVA');
    }
    return response.json();
  },
};

// ── Facturas ────────────────────────────────────────────────
export const facturasAPI = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/facturas${q ? '?' + q : ''}`);
  },
  get: (id) => request(`/facturas/${id}`),
  create: (body) => request('/facturas', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/facturas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  resumen: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/facturas/reporte/resumen${q ? '?' + q : ''}`);
  },
  controlPagos: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/facturas/reporte/control-pagos${q ? '?' + q : ''}`);
  },
  previewSinRelacion: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/facturas/sin-relacion/preview${q ? '?' + q : ''}`);
  },
  notasCreditoDisponibles: (nitEmisores) => {
    const q = new URLSearchParams({ nit_emisores: (nitEmisores || []).join(',') }).toString();
    return request(`/facturas/notas-credito-disponibles?${q}`);
  },
  eliminarSinRelacion: (body) => request('/facturas/sin-relacion', {
    method: 'DELETE',
    body: JSON.stringify({ confirmacion: 'ELIMINAR SIN RELACION', ...body }),
  }),
};

// ── Métodos de Pago ─────────────────────────────────────────
export const pagosAPI = {
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/metodos-pago${q ? '?' + q : ''}`);
  },
  disponibles: () => request('/metodos-pago/disponibles'),
  get: (id) => request(`/metodos-pago/${id}`),
  create: (body) => request('/metodos-pago', { method: 'POST', body: JSON.stringify(body) }),
  update: (id, body) => request(`/metodos-pago/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  confirmar: (id, body) => request(`/metodos-pago/${id}/confirmar`, { method: 'POST', body: JSON.stringify(body || {}) }),
  anular: (id) => request(`/metodos-pago/${id}/anular`, { method: 'POST', body: JSON.stringify({}) }),
  delete: (id) => request(`/metodos-pago/${id}`, { method: 'DELETE' }),
};

// ── Conciliaciones ──────────────────────────────────────────
export const conciliacionesAPI = {
  crear: (body) => request('/conciliaciones', { method: 'POST', body: JSON.stringify(body) }),
  batch: (body) => request('/conciliaciones/batch', { method: 'POST', body: JSON.stringify(body) }),
  efectivo: (body) => request('/conciliaciones/efectivo', { method: 'POST', body: JSON.stringify(body) }),
  revertir: (id) => request(`/conciliaciones/${id}`, { method: 'DELETE' }),
  list: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/conciliaciones${q ? '?' + q : ''}`);
  },
  reporte: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/conciliaciones/reporte${q ? '?' + q : ''}`);
  },
};

// ── Importación Excel ───────────────────────────────────────
export const excelAPI = {
    analizar: (file) => {
        const fd = new FormData();
        fd.append('excel', file);
        return fetch(`${BASE}/importacion-excel/analizar`, { method: 'POST', body: fd })
            .then(r => r.json().then(j => { if (!r.ok) throw new Error(j.error); return j; }));
    },
    confirmar: (file, mapeo, tipo_documento, usuario_email) => {
        const fd = new FormData();
        fd.append('excel', file);
        fd.append('mapeo', JSON.stringify(mapeo));
        fd.append('tipo_documento', tipo_documento);
        fd.append('usuario_email', usuario_email);
        return fetch(`${BASE}/importacion-excel/confirmar`, { method: 'POST', body: fd })
            .then(r => r.json().then(j => { if (!r.ok) throw new Error(j.error); return j; }));
    },
    historial: () => request('/importacion-excel/historial'),
    campos: () => request('/importacion-excel/campos'),
};

// ── Métricas ────────────────────────────────────────────────
export const metricsAPI = {
  get: () => request('/metrics'),
};

// ── Admin (modo pruebas) ────────────────────────────────────
export const adminAPI = {
  resetAllData: (usuario_email) => request('/admin/reset-all-data', {
    method: 'POST',
    body: JSON.stringify({ confirmacion: 'RESET NEXUS DOC AI', usuario_email }),
  }),
  tokenStats: () => request('/admin/token-stats'),
};

