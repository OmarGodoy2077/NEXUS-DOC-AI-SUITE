const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const { analizarExcel, procesarConMapeo } = require('../utils/excelParser');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = (supabase) => {

  /**
   * POST /api/importacion-excel/analizar
   * Paso 1: el usuario sube el Excel. El backend devuelve:
   *   - headers detectados
   *   - mapeo sugerido (inferido automáticamente)
   *   - preview de los primeros 5 registros
   * El frontend muestra esto para que el usuario corrija el mapeo.
   */
  router.post('/analizar', upload.single('excel'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo Excel' });

      const ext = req.file.originalname.split('.').pop().toLowerCase();
      if (!['xls', 'xlsx', 'xlsm'].includes(ext)) {
        return res.status(400).json({ error: 'El archivo debe ser formato Excel (.xls, .xlsx, .xlsm)' });
      }

      // Verificar si ya fue importado (deduplicación por hash)
      const fileHash = crypto.createHash('md5').update(req.file.buffer).digest('hex');
      const { data: importacionExistente } = await supabase
        .from('importaciones_excel')
        .select('id, created_at, filas_importadas')
        .eq('file_hash', fileHash)
        .maybeSingle();

      if (importacionExistente) {
        return res.status(409).json({
          error: 'Este archivo ya fue importado anteriormente.',
          importacion_previa: importacionExistente,
        });
      }

      const analisis = analizarExcel(req.file.buffer, req.file.originalname);

      // No exponemos rawData al cliente, sólo el análisis
      const { rawData, ...analisisSinDatos } = analisis;

      res.json({
        success: true,
        ...analisisSinDatos,
        instrucciones: 'Revise el mappingSugerido y corrija los índices de columna si es necesario antes de confirmar la importación.',
      });
    } catch (err) {
      console.error('Error analizando Excel:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/importacion-excel/confirmar
   * Paso 2: el usuario confirma el mapeo (posiblemente corregido).
   * El backend procesa e inserta en `facturas`.
   *
   * Body: { fileHash, mapeo: { campo_sistema: indice_columna }, tipo_documento, usuario_email }
   * IMPORTANTE: el archivo se sube de nuevo aquí. Alternativa: sesión temporal.
   */
  router.post('/confirmar', upload.single('excel'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No se recibió el archivo Excel' });

      const mapeo = JSON.parse(req.body.mapeo || '{}');
      const tipo_documento = req.body.tipo_documento || 'compra';
      const usuario_email  = req.body.usuario_email  || 'sistema';

      if (Object.keys(mapeo).length === 0) {
        return res.status(400).json({ error: 'El mapeo de columnas no puede estar vacío' });
      }

      const analisis = analizarExcel(req.file.buffer, req.file.originalname);

      // Segunda verificación de duplicado
      const { data: importacionExistente } = await supabase
        .from('importaciones_excel')
        .select('id')
        .eq('file_hash', analisis.fileHash)
        .maybeSingle();

      if (importacionExistente) {
        return res.status(409).json({ error: 'Este archivo ya fue importado anteriormente.' });
      }

      // Procesar con el mapeo confirmado
      const { registros, errores } = procesarConMapeo(analisis.rawData, analisis.headers, mapeo);

      if (registros.length === 0) {
        return res.status(422).json({
          error: 'No se pudo procesar ningún registro con el mapeo proporcionado.',
          errores,
        });
      }

      // Insertar en lotes de 100 para no saturar la conexión
      const BATCH_SIZE = 100;
      let insertados = 0;
      let duplicados = 0;
      const erroresDB = [];

      for (let i = 0; i < registros.length; i += BATCH_SIZE) {
        const lote = registros.slice(i, i + BATCH_SIZE).map(r => ({
          ...r,
          tipo_documento,
          usuario_creacion: usuario_email,
        }));

        const { data: inserted, error: iErr } = await supabase
          .from('facturas')
          .upsert(lote, {
            onConflict: 'numero_autorizacion',
            ignoreDuplicates: true,
          })
          .select('id');

        if (iErr) {
          erroresDB.push({ lote: Math.floor(i / BATCH_SIZE) + 1, error: iErr.message });
        } else {
          insertados += inserted?.length || 0;
          duplicados += lote.length - (inserted?.length || 0);
        }
      }

      // Detectar rango de fechas del archivo
      const fechas = registros.map(r => r.fecha_emision).filter(Boolean).sort();

      // Registrar en historial de importaciones
      await supabase.from('importaciones_excel').insert([{
        nombre_archivo:      req.file.originalname,
        file_hash:           analisis.fileHash,
        total_filas:         analisis.totalFilas,
        filas_importadas:    insertados,
        filas_duplicadas:    duplicados,
        filas_error:         errores.length + erroresDB.length,
        mapeo_columnas:      mapeo,
        periodo_desde:       fechas[0] || null,
        periodo_hasta:       fechas[fechas.length - 1] || null,
        estado_importacion:  erroresDB.length > 0 ? 'parcial' : 'completada',
        errores_detalle:     [...errores, ...erroresDB],
        usuario_importacion: usuario_email,
      }]);

      res.json({
        success: true,
        resumen: {
          total_en_archivo: analisis.totalFilas,
          insertados,
          duplicados,
          errores_parseo: errores.length,
          errores_db: erroresDB.length,
        },
        errores: errores.slice(0, 20), // max 20 errores en respuesta
      });
    } catch (err) {
      console.error('Error en importación Excel:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/importacion-excel/historial — lista de importaciones anteriores
  router.get('/historial', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('importaciones_excel')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/importacion-excel/campos — devuelve el catálogo de campos del sistema
  // Usado por el frontend para construir la UI de mapeo dinámico
  router.get('/campos', (req, res) => {
    const { CAMPO_ALIAS } = require('../utils/excelParser');
    const campos = Object.keys(CAMPO_ALIAS).map(campo => ({
      campo,
      descripcion: campoDescripcion(campo),
      requerido: ['monto_total', 'numero_autorizacion'].includes(campo),
    }));
    res.json({ campos });
  });

  return router;
};

function campoDescripcion(campo) {
  const desc = {
    fecha_emision:        'Fecha de emisión del DTE',
    numero_autorizacion:  'UUID de autorización SAT (campo único)',
    tipo_dte:             'Tipo de documento (FPEQ, FACT, etc.)',
    serie:                'Serie del DTE',
    numero_dte:           'Número correlativo del DTE',
    nit_emisor:           'NIT del emisor/vendedor',
    nombre_emisor:        'Nombre completo del emisor',
    codigo_establecimiento: 'Código de establecimiento del emisor',
    nombre_establecimiento: 'Nombre del establecimiento',
    id_receptor:          'NIT del receptor o CF',
    nombre_receptor:      'Nombre del receptor/comprador',
    nit_certificador:     'NIT del certificador (SAT)',
    nombre_certificador:  'Nombre del certificador',
    estado:               'Estado del DTE (Vigente/Anulado)',
    moneda:               'Moneda (GTQ por defecto)',
    monto_total:          'Monto total del documento',
    monto_iva:            'Monto del impuesto IVA',
    marca_anulado:        'Indicador de anulación (Si/No)',
    fecha_anulacion:      'Fecha en que fue anulado',
    exportacion:          'Si es documento de exportación',
    ubicacion_temporal:   'Ubicación temporal',
    clasificacion_emisor: 'Clasificación del emisor',
  };
  return desc[campo] || campo;
}
