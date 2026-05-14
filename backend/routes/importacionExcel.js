const express = require('express');
const router = express.Router();
const multer = require('multer');
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

      // Nota: ya NO bloqueamos reimportar el mismo archivo.
      // La deduplicación ahora es a nivel de fila (numero_autorizacion).
      // Reimportar el mismo Excel es válido cuando contiene anulaciones nuevas.
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

      // Procesar con el mapeo confirmado
      const { registros, errores } = procesarConMapeo(analisis.rawData, analisis.headers, mapeo);

      if (registros.length === 0) {
        return res.status(422).json({
          error: 'No se pudo procesar ningún registro con el mapeo proporcionado.',
          errores,
        });
      }

      // ── PRE-CHECK: separar registros nuevos vs existentes por numero_autorizacion ──
      const registrosConAuth = registros.filter(r => r.numero_autorizacion);
      const registrosSinAuth = registros.filter(r => !r.numero_autorizacion);
      const auths = registrosConAuth.map(r => r.numero_autorizacion);

      // Traer en una sola consulta todas las facturas existentes con ese conjunto de UUIDs
      const existentesMap = {};
      if (auths.length > 0) {
        // Chunk de 500 para evitar URIs gigantes en supabase-js
        const CHUNK = 500;
        for (let i = 0; i < auths.length; i += CHUNK) {
          const slice = auths.slice(i, i + CHUNK);
          const { data: existentes, error: eErr } = await supabase
            .from('facturas')
            .select('id, numero_autorizacion, estado, marca_anulado, monto_total, monto_pagado')
            .in('numero_autorizacion', slice);
          if (eErr) throw eErr;
          existentes.forEach(e => { existentesMap[e.numero_autorizacion] = e; });
        }
      }

      // ── Clasificar cada registro ──
      const aInsertar       = [];       // nuevos (no existían)
      const aActualizarAnular = [];     // existentes que cambiaron a anulado
      const duplicadosReales  = [];     // existentes sin cambios

      registrosConAuth.forEach(r => {
        const existente = existentesMap[r.numero_autorizacion];
        if (!existente) {
          aInsertar.push(r);
          return;
        }

        // ¿Cambió el estado de vigente → anulado?
        // En el Excel: marca_anulado=true. En BD: estado != 'anulada'
        if (r.marca_anulado && existente.estado !== 'anulada') {
          aActualizarAnular.push({
            id:                  existente.id,
            numero_autorizacion: r.numero_autorizacion,
            fecha_anulacion:     r.fecha_anulacion,
            // Para construir el reporte: ¿tenía conciliaciones?
            monto_pagado_previo: Number(existente.monto_pagado) || 0,
          });
        } else {
          duplicadosReales.push(r.numero_autorizacion);
        }
      });

      // Registros sin numero_autorizacion → tratarlos como insert directo (sin dedup)
      aInsertar.push(...registrosSinAuth);

      // ── 1) INSERTAR nuevos en lotes ──
      const BATCH_SIZE = 100;
      let insertados = 0;
      const erroresDB = [];

      for (let i = 0; i < aInsertar.length; i += BATCH_SIZE) {
        const lote = aInsertar.slice(i, i + BATCH_SIZE).map(r => ({
          ...r,
          // El parser ya decide tipo_documento ('nota_credito' o 'compra').
          // Solo lo sobrescribimos con el del formulario si NO es nota de crédito.
          tipo_documento:   r.tipo_documento === 'nota_credito' ? 'nota_credito' : tipo_documento,
          usuario_creacion: usuario_email,
        }));

        const { data: inserted, error: iErr } = await supabase
          .from('facturas')
          .upsert(lote, { onConflict: 'numero_autorizacion', ignoreDuplicates: true })
          .select('id');

        if (iErr) {
          erroresDB.push({ lote: Math.floor(i / BATCH_SIZE) + 1, error: iErr.message });
        } else {
          insertados += inserted?.length || 0;
        }
      }

      // ── 2) ANULAR facturas que cambiaron de estado ──
      // Para cada una: identificar si tenía conciliaciones, revertirlas, y marcarla como anulada.
      const facturasAnuladasConRelaciones = [];
      let conciliacionesRevertidas = 0;
      let facturasAnuladas = 0;

      for (const af of aActualizarAnular) {
        // Buscar conciliaciones vinculadas a esta factura
        const { data: conciliaciones, error: cErr } = await supabase
          .from('conciliaciones')
          .select('id, monto_aplicado, metodo_pago_id, metodos_pago(tipo, banco, numero_documento)')
          .eq('factura_id', af.id);

        if (cErr) {
          erroresDB.push({ anulacion: af.numero_autorizacion, error: cErr.message });
          continue;
        }

        if (conciliaciones && conciliaciones.length > 0) {
          // Registrar para el reporte que se mostrará al usuario
          facturasAnuladasConRelaciones.push({
            numero_autorizacion: af.numero_autorizacion,
            monto_pagado_previo: af.monto_pagado_previo,
            conciliaciones: conciliaciones.map(c => ({
              id:               c.id,
              monto_aplicado:   Number(c.monto_aplicado),
              tipo_pago:        c.metodos_pago?.tipo,
              banco:            c.metodos_pago?.banco,
              numero_documento: c.metodos_pago?.numero_documento,
            })),
          });

          // Revertir conciliaciones (los triggers ajustan saldos automáticamente)
          const idsBorrar = conciliaciones.map(c => c.id);
          const { error: dErr } = await supabase
            .from('conciliaciones')
            .delete()
            .in('id', idsBorrar);
          if (dErr) {
            erroresDB.push({ anulacion: af.numero_autorizacion, error: 'No se pudieron revertir conciliaciones: ' + dErr.message });
            continue;
          }
          conciliacionesRevertidas += conciliaciones.length;
        }

        // Marcar la factura como anulada
        const { error: uErr } = await supabase
          .from('facturas')
          .update({
            estado:          'anulada',
            marca_anulado:   true,
            fecha_anulacion: af.fecha_anulacion,
            updated_at:      new Date().toISOString(),
          })
          .eq('id', af.id);

        if (uErr) {
          erroresDB.push({ anulacion: af.numero_autorizacion, error: uErr.message });
        } else {
          facturasAnuladas++;
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
        filas_duplicadas:    duplicadosReales.length,
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
          total_en_archivo:    analisis.totalFilas,
          insertados,
          duplicados:          duplicadosReales.length,
          facturas_anuladas:   facturasAnuladas,
          conciliaciones_revertidas: conciliacionesRevertidas,
          errores_parseo:      errores.length,
          errores_db:          erroresDB.length,
        },
        facturas_anuladas_con_relaciones: facturasAnuladasConRelaciones,
        errores: errores.slice(0, 20),
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
