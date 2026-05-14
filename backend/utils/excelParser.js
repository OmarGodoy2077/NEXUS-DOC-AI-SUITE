/**
 * Parser de Excel SAT Guatemala (Agencia Virtual - DTE-FEL)
 *
 * Diseño: mapeo dinámico. El SAT cambia los nombres/orden de columnas
 * entre versiones. El sistema detecta columnas por similitud semántica
 * y permite al usuario corregir el mapeo antes de importar.
 */

const XLSX = require('xlsx');
const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────
// CATÁLOGO DE COLUMNAS CONOCIDAS DEL SAT
// Cada campo del sistema puede encontrarse con múltiples nombres
// ─────────────────────────────────────────────────────────────
const CAMPO_ALIAS = {
  fecha_emision: [
    'fecha de emisi', 'fecha emision', 'fecha_emision',
    'fecha de emisión', 'fecha_emision'
  ],
  numero_autorizacion: [
    'número de autorización', 'numero de autorizacion', 'no. autorización',
    'num autorizacion', 'numero_autorizacion', 'uuid', 'autorizacion'
  ],
  tipo_dte: [
    'tipo de dte', 'tipo dte', 'tipo_dte', 'tipo de documento',
    'nombre dte', 'tipo de dte (nombre)'
  ],
  serie: ['serie', 'serie del dte', 'serie_dte'],
  numero_dte: [
    'número del dte', 'numero del dte', 'numero_dte', 'no. dte',
    'num dte', 'numero de dte'
  ],
  nit_emisor: [
    'nit del emisor', 'nit_emisor', 'nit emisor', 'nit del vendedor'
  ],
  nombre_emisor: [
    'nombre completo del emisor', 'nombre emisor', 'nombre_emisor',
    'razon social emisor', 'emisor'
  ],
  codigo_establecimiento: [
    'código de establecimiento', 'codigo establecimiento',
    'cod establecimiento', 'codigo_establecimiento'
  ],
  nombre_establecimiento: [
    'nombre del establecimiento', 'nombre establecimiento',
    'establecimiento', 'nombre_establecimiento'
  ],
  id_receptor: [
    'id del receptor', 'nit del receptor', 'nit_receptor',
    'id receptor', 'receptor nit'
  ],
  nombre_receptor: [
    'nombre completo del receptor', 'nombre receptor',
    'nombre_receptor', 'receptor', 'razon social receptor'
  ],
  nit_certificador: ['nit del certificador', 'nit_certificador', 'certificador nit'],
  nombre_certificador: ['nombre completo del certificador', 'nombre_certificador'],
  estado: ['estado', 'estado del dte', 'vigente', 'status'],
  moneda: ['moneda', 'currency', 'tipo moneda'],
  monto_total: [
    'gran total', 'monto total', 'monto_total', 'total',
    'gran total (moneda original)', 'importe total', 'valor total'
  ],
  monto_iva: [
    'iva', 'iva (monto de este impuesto)', 'monto iva',
    'impuesto iva', 'iva_monto'
  ],
  marca_anulado: ['marca de anulado', 'anulado', 'marca_anulado', 'es anulado'],
  fecha_anulacion: ['fecha de anulación', 'fecha anulacion', 'fecha_anulacion'],
  exportacion: ['exportación', 'exportacion', 'es exportacion'],
  ubicacion_temporal: ['ubicación temporal', 'ubicacion temporal', 'ubicacion_temporal'],
  clasificacion_emisor: ['clasificación emisor', 'clasificacion emisor', 'clasificacion_emisor'],
};

// Impuestos especiales → van al JSONB otros_impuestos
const IMPUESTOS_ESPECIALES = [
  'petróleo', 'turismo hospedaje', 'turismo pasajes',
  'timbre de prensa', 'bomberos', 'tasa municipal',
  'bebidas alcohólicas', 'tabaco', 'cemento',
  'bebidas no alcohólicas', 'tarifa portuaria'
];

// ─────────────────────────────────────────────────────────────
// FUNCIÓN PRINCIPAL: parsear y mapear columnas
// ─────────────────────────────────────────────────────────────

/**
 * Lee un archivo Excel SAT y devuelve:
 *  - headers: columnas originales del Excel
 *  - mappingSugerido: mapeo inferido automáticamente
 *  - preview: primeras 5 filas de datos crudos
 *  - totalFilas: total de registros
 *  - fileHash: hash del archivo para deduplicación
 */
function analizarExcel(buffer, nombreArchivo) {
  const fileHash = crypto.createHash('md5').update(buffer).digest('hex');
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  // Buscar la hoja correcta (SAT usa 'InformacionDTE-FEL' pero puede variar)
  const sheetName = wb.SheetNames.find(n =>
    n.toLowerCase().includes('dte') ||
    n.toLowerCase().includes('informacion') ||
    n.toLowerCase().includes('factura')
  ) || wb.SheetNames[0];

  const ws = wb.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (rawData.length < 2) {
    throw new Error('El archivo Excel no contiene datos suficientes (mínimo 1 fila de encabezado + 1 de datos).');
  }

  // Fila 0 = encabezados, resto = datos
  // Algunos .xls antiguos del SAT vienen en CP-1252 y xlsx los entrega como
  // UTF-8 mal decodificado (mojibake: "AutorizaciÃ³n" en vez de "Autorización").
  const headers = rawData[0].map(h => repararMojibake(String(h).trim()));
  const dataRows = rawData.slice(1)
    .filter(row => row.some(cell => cell !== ''))
    .map(row => row.map(cell => typeof cell === 'string' ? repararMojibake(cell) : cell));

  // Inferir mapeo
  const mappingSugerido = inferirMapeo(headers);

  // Detectar impuestos especiales en las columnas
  const impuestosEncontrados = detectarImpuestos(headers);

  return {
    fileHash,
    nombreArchivo,
    sheetName,
    headers,
    mappingSugerido,
    impuestosEncontrados,
    totalFilas: dataRows.length,
    preview: dataRows.slice(0, 5).map(row => crearObjeto(row, headers)),
    rawData: dataRows, // sólo en memoria, no se serializa
  };
}

/**
 * Aplica un mapeo de columnas a los datos crudos y devuelve
 * registros listos para insertar en la tabla `facturas`.
 *
 * @param {Array} rawData - filas crudas del Excel
 * @param {Array} headers - nombres de columnas originales
 * @param {Object} mapeo  - { campo_sistema: indice_columna_excel }
 * @returns {Object} { registros, errores }
 */
function procesarConMapeo(rawData, headers, mapeo) {
  const registros = [];
  const errores = [];

  // Normalizar mapeo: garantizar que todos los valores sean Number
  const mapeoNorm = {};
  Object.entries(mapeo).forEach(([k, v]) => {
    const n = Number(v);
    if (!isNaN(n)) mapeoNorm[k] = n;
  });

  rawData.forEach((fila, idx) => {
    try {
      const fila_num = idx + 2;
      // Asegurar que la fila tenga al menos tantos elementos como headers
      const filaCompleta = headers.map((_, i) => fila[i] ?? '');
      const reg = transformarFila(filaCompleta, headers, mapeoNorm, fila_num);
      if (reg) registros.push(reg);
    } catch (e) {
      errores.push({ fila: idx + 2, error: e.message });
    }
  });

  return { registros, errores };
}

// ─────────────────────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────────────────────

function inferirMapeo(headers) {
  const mapeo = {};

  // For each header find the campo whose LONGEST alias is a substring of the header.
  // "Longest alias wins" prevents short aliases like "moneda" from stealing
  // the column "Gran Total (Moneda Original)" away from monto_total.
  headers.forEach((header, colIdx) => {
    const headerNorm = normalizar(header);
    let bestCampo = null;
    let bestLen   = -1;

    for (const [campo, aliases] of Object.entries(CAMPO_ALIAS)) {
      if (mapeo[campo] !== undefined) continue; // campo already claimed

      for (const alias of aliases) {
        const aliasNorm = normalizar(alias);
        // Only match if the header *contains* the alias (not the reverse —
        // that caused "Moneda" to match alias "gran total moneda original").
        if (headerNorm === aliasNorm || headerNorm.includes(aliasNorm)) {
          if (aliasNorm.length > bestLen) {
            bestLen   = aliasNorm.length;
            bestCampo = campo;
          }
        }
      }
    }

    if (bestCampo !== null) {
      mapeo[bestCampo] = colIdx;
    }
  });

  return mapeo;
}

function detectarImpuestos(headers) {
  const encontrados = [];
  headers.forEach((h, idx) => {
    const hNorm = normalizar(h);
    const eImpuesto = IMPUESTOS_ESPECIALES.some(imp => hNorm.includes(normalizar(imp)));
    if (eImpuesto) {
      encontrados.push({ nombre: h.trim(), colIdx: idx });
    }
  });
  return encontrados;
}

function crearObjeto(fila, headers) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = fila[i] ?? ''; });
  return obj;
}

function transformarFila(filaCompleta, headers, mapeo, filaNum) {
  const get = (campo) => {
    const idx = mapeo[campo];
    if (idx === undefined || idx === null) return null;
    return filaCompleta[idx] ?? null;
  };

  // Campo obligatorio: monto_total
  const montoRaw = get('monto_total');
  let monto = parsearMonto(montoRaw);
  if (!monto || monto <= 0) {
    throw new Error(`Fila ${filaNum}: monto_total inválido (${montoRaw})`);
  }

  // Detección de Nota de Crédito → el monto pasa a NEGATIVO porque resta a las facturas
  // Formas que el SAT puede usar para identificarla: 'NCRE', 'NotaCredito', 'Nota de Crédito'
  const tipoDteRaw = String(get('tipo_dte') || '').toUpperCase().trim();
  const esNotaCredito =
    tipoDteRaw === 'NCRE' ||
    tipoDteRaw.includes('NOTA DE CR') ||
    tipoDteRaw.includes('NOTA CR') ||
    tipoDteRaw.includes('NOTACREDITO');

  if (esNotaCredito) monto = -Math.abs(monto);

  // Estado SAT → estado interno
  const estadoSAT = String(get('estado') || '').toLowerCase();
  const esAnulado = estadoSAT.includes('anula') || String(get('marca_anulado') || '').toLowerCase() === 'si';

  // Otros impuestos → JSONB
  const otrosImpuestos = {};
  Object.entries(mapeo).forEach(([campo, idx]) => {
    if (campo.startsWith('impuesto_')) {
      const nombre = campo.replace('impuesto_', '');
      const val = filaCompleta[idx];
      const monto_imp = parsearMonto(val);
      if (monto_imp > 0) otrosImpuestos[nombre] = monto_imp;
    }
  });

  return {
    numero_autorizacion:   limpiarTexto(get('numero_autorizacion')),
    tipo_dte:              limpiarTexto(get('tipo_dte')),
    serie:                 limpiarTexto(get('serie')),
    numero_dte:            limpiarTexto(get('numero_dte')),
    fecha_emision:         parsearFecha(get('fecha_emision')),
    fecha_anulacion:       esAnulado ? parsearFecha(get('fecha_anulacion')) : null,
    marca_anulado:         esAnulado,
    exportacion:           parsearBooleano(get('exportacion')),
    ubicacion_temporal:    parsearBooleano(get('ubicacion_temporal')),
    clasificacion_emisor:  limpiarTexto(get('clasificacion_emisor')),
    nit_emisor:            limpiarTexto(get('nit_emisor')),
    nombre_emisor:         limpiarTexto(get('nombre_emisor')),
    codigo_establecimiento: limpiarTexto(get('codigo_establecimiento')),
    nombre_establecimiento: limpiarTexto(get('nombre_establecimiento')),
    id_receptor:           limpiarTexto(get('id_receptor')),
    nombre_receptor:       limpiarTexto(get('nombre_receptor')),
    nit_certificador:      limpiarTexto(get('nit_certificador')),
    nombre_certificador:   limpiarTexto(get('nombre_certificador')),
    moneda:                limpiarTexto(get('moneda')) || 'GTQ',
    monto_total:           monto,
    monto_iva:             parsearMonto(get('monto_iva')) || 0,
    otros_impuestos:       otrosImpuestos,
    // Estado inicial:
    //   - Anulada SAT  → 'anulada'
    //   - Nota crédito → 'nota_credito' (no participa en conciliaciones; se usa como ajuste al cuadrar)
    //   - Resto        → 'pendiente'
    estado:                esAnulado ? 'anulada' : (esNotaCredito ? 'nota_credito' : 'pendiente'),
    // Si es NCRE, la clasificación contable cambia a nota_credito
    tipo_documento:        esNotaCredito ? 'nota_credito' : 'compra',
    origen:                'sat_excel',
  };
}

// ─────────────────────────────────────────────────────────────
// UTILIDADES DE PARSEO
// ─────────────────────────────────────────────────────────────

/**
 * Repara mojibake típico de archivos Excel del SAT.
 * El xlsx parser entrega bytes Latin-1 como si fueran UTF-8, generando:
 *   "Ã³" en vez de "ó", "Ã±" en vez de "ñ", "Ã©" en vez de "é", etc.
 *
 * Estrategia: si detectamos "Ã" en el string (señal inequívoca de mojibake),
 * convertimos el string a bytes Latin-1 y los re-decodificamos como UTF-8.
 */
function repararMojibake(str) {
  if (typeof str !== 'string') return str;
  if (!str.includes('Ã') && !str.includes('Â')) return str;
  try {
    // Buffer.from(str, 'latin1') invierte la mala decodificación,
    // y toString('utf8') la rehace correctamente.
    return Buffer.from(str, 'latin1').toString('utf8');
  } catch {
    return str;
  }
}

function normalizar(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quitar acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsearMonto(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return valor;
  const limpio = String(valor)
    .replace(/Q\s*/gi, '')
    .replace(/,(?=\d{3})/g, '')  // comas de miles
    .replace(/\s/g, '')
    .trim();
  const num = parseFloat(limpio);
  return isNaN(num) ? 0 : num;
}

function parsearFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor.toISOString();
  const str = String(valor).trim();
  if (!str) return null;
  try {
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function parsearBooleano(valor) {
  if (!valor) return false;
  const str = String(valor).toLowerCase().trim();
  return str === 'si' || str === 'sí' || str === 'yes' || str === 'true' || str === '1';
}

function limpiarTexto(valor) {
  if (!valor) return null;
  const str = String(valor).trim();
  return str === '' ? null : str;
}

module.exports = {
  analizarExcel,
  procesarConMapeo,
  CAMPO_ALIAS,
};
