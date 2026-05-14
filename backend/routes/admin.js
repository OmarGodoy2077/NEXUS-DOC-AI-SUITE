const express = require('express');
const router = express.Router();

module.exports = (supabase) => {

  // GET /api/admin/token-stats — promedios de consumo de tokens del OCR
  // Precios actuales de Gemini 3.1 Flash-Lite (USD por millón de tokens):
  //   • Input  (prompt + imagen): $0.50
  //   • Output (respuesta JSON):  $3.00
  router.get('/token-stats', async (req, res) => {
    try {
      const PRICE_INPUT_PER_M  = 0.50;
      const PRICE_OUTPUT_PER_M = 3.00;

      const { data, error } = await supabase
        .from('metodos_pago')
        .select('tokens_prompt, tokens_respuesta, tokens_total, ocr_modelo, created_at')
        .not('tokens_total', 'is', null)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const total_docs = data.length;

      if (total_docs === 0) {
        return res.json({
          total_docs: 0,
          promedio_total: 0,
          promedio_prompt: 0,
          promedio_respuesta: 0,
          total_tokens: 0,
          costo_estimado_usd: 0,
          modelos: [],
          ultimos_7_dias: [],
        });
      }

      // Acumulados y promedios
      let sumPrompt = 0, sumRespuesta = 0, sumTotal = 0;
      const modelos = new Set();

      data.forEach(r => {
        sumPrompt    += Number(r.tokens_prompt    || 0);
        sumRespuesta += Number(r.tokens_respuesta || 0);
        sumTotal     += Number(r.tokens_total     || 0);
        if (r.ocr_modelo) modelos.add(r.ocr_modelo);
      });

      // Costo total: input * precio_input + output * precio_output
      const costo_estimado_usd =
        (sumPrompt    / 1_000_000) * PRICE_INPUT_PER_M +
        (sumRespuesta / 1_000_000) * PRICE_OUTPUT_PER_M;

      // Serie por día (últimos 7 días con datos)
      const porDia = {};
      data.forEach(r => {
        const day = r.created_at.split('T')[0];
        if (!porDia[day]) porDia[day] = { day, docs: 0, tokens: 0 };
        porDia[day].docs   += 1;
        porDia[day].tokens += Number(r.tokens_total || 0);
      });
      const ultimos_7_dias = Object.values(porDia)
        .sort((a, b) => a.day.localeCompare(b.day))
        .slice(-7);

      // Costo promedio por documento (sirve para proyecciones)
      const costo_promedio_por_doc = costo_estimado_usd / total_docs;

      res.json({
        total_docs,
        promedio_total:        Math.round(sumTotal     / total_docs),
        promedio_prompt:       Math.round(sumPrompt    / total_docs),
        promedio_respuesta:    Math.round(sumRespuesta / total_docs),
        total_tokens:          sumTotal,
        costo_estimado_usd:    Number(costo_estimado_usd.toFixed(4)),
        costo_promedio_por_doc: Number(costo_promedio_por_doc.toFixed(6)),
        // Precios usados (para mostrar en UI)
        precios: {
          input_por_m:  PRICE_INPUT_PER_M,
          output_por_m: PRICE_OUTPUT_PER_M,
        },
        modelos: [...modelos],
        ultimos_7_dias,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/reset-all-data — ⚠️ MODO PRUEBAS
  // Elimina TODO: conciliaciones, métodos de pago, facturas, importaciones,
  // transacciones, y vacía el bucket 'comprobantes'. Requiere confirmación explícita.
  router.post('/reset-all-data', async (req, res) => {
    try {
      const { confirmacion, usuario_email } = req.body;

      // Doble seguro: el cliente debe enviar EXACTAMENTE este string
      if (confirmacion !== 'RESET NEXUS DOC AI') {
        return res.status(400).json({
          error: 'Confirmación inválida. Debes enviar { confirmacion: "RESET NEXUS DOC AI" }.',
        });
      }

      console.log(`\n⚠️  RESET TOTAL solicitado por: ${usuario_email || 'desconocido'}`);

      const resumen = {
        conciliaciones: 0,
        metodos_pago: 0,
        facturas: 0,
        importaciones_excel: 0,
        transacciones: 0,
        storage_files: 0,
        errores: [],
      };

      // ── 1. Vaciar bucket de storage ────────────────────────────
      try {
        const { data: files, error: listErr } = await supabase.storage
          .from('comprobantes')
          .list('', { limit: 1000 });

        if (listErr) throw listErr;

        if (files && files.length > 0) {
          const fileNames = files.map(f => f.name);
          const { error: removeErr } = await supabase.storage
            .from('comprobantes')
            .remove(fileNames);
          if (removeErr) throw removeErr;
          resumen.storage_files = fileNames.length;
          console.log(`🗑️  ${fileNames.length} archivo(s) eliminados de storage`);
        }
      } catch (e) {
        console.error('Error limpiando storage:', e.message);
        resumen.errores.push(`storage: ${e.message}`);
      }

      // ── 2. Eliminar en orden por dependencias FK ───────────────
      // conciliaciones → depende de facturas + metodos_pago
      // metodos_pago, facturas → independientes una vez sin conciliaciones
      // transacciones → depende de facturas + metodos_pago
      const tablasOrdenadas = [
        'conciliaciones',
        'transacciones',
        'metodos_pago',
        'facturas',
        'importaciones_excel',
      ];

      for (const tabla of tablasOrdenadas) {
        try {
          // Contar antes
          const { count } = await supabase
            .from(tabla)
            .select('id', { count: 'exact', head: true });

          if (count > 0) {
            // Filtro imposible para borrar todos (Supabase requiere un filtro siempre)
            const { error } = await supabase
              .from(tabla)
              .delete()
              .not('id', 'is', null);

            if (error) throw error;
            resumen[tabla] = count;
            console.log(`🗑️  ${count} registro(s) eliminados de ${tabla}`);
          }
        } catch (e) {
          console.error(`Error vaciando ${tabla}:`, e.message);
          resumen.errores.push(`${tabla}: ${e.message}`);
        }
      }

      console.log('✅ Reset total completado:', resumen);

      res.json({
        success: resumen.errores.length === 0,
        message: resumen.errores.length === 0
          ? 'Sistema reseteado correctamente. Listo para pruebas desde cero.'
          : 'Reset completado con algunos errores. Revisa los detalles.',
        resumen,
      });

    } catch (err) {
      console.error('❌ Error en reset total:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
