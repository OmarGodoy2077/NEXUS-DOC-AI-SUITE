const express = require('express');
const router = express.Router();

module.exports = (supabase) => {

  // POST /api/conciliaciones — vincular un método de pago a una factura
  // Este es el endpoint más crítico del sistema financiero.
  router.post('/', async (req, res) => {
    try {
      const {
        factura_id, metodo_pago_id, monto_aplicado,
        fecha_conciliacion, usuario_email, notas
      } = req.body;

      // ── Validaciones básicas ──
      if (!factura_id)     return res.status(400).json({ error: 'factura_id es requerido' });
      if (!metodo_pago_id) return res.status(400).json({ error: 'metodo_pago_id es requerido' });
      if (!monto_aplicado || monto_aplicado <= 0)
        return res.status(400).json({ error: 'monto_aplicado debe ser mayor a 0' });

      // ── Cargar factura ──
      const { data: factura, error: fErr } = await supabase
        .from('facturas')
        .select('id, estado, monto_total, monto_pagado, saldo_pendiente')
        .eq('id', factura_id)
        .single();
      if (fErr || !factura) return res.status(404).json({ error: 'Factura no encontrada' });
      if (factura.estado === 'anulada') return res.status(409).json({ error: 'La factura está anulada' });
      if (factura.estado === 'pagada')  return res.status(409).json({ error: 'La factura ya está completamente pagada' });

      // ── Cargar método de pago ──
      const { data: pago, error: pErr } = await supabase
        .from('metodos_pago')
        .select('id, estado, monto_inicial, saldo_utilizado, saldo_disponible')
        .eq('id', metodo_pago_id)
        .single();
      if (pErr || !pago) return res.status(404).json({ error: 'Método de pago no encontrado' });
      if (pago.estado === 'anulado')       return res.status(409).json({ error: 'El método de pago está anulado' });
      if (pago.estado === 'utilizado_total') return res.status(409).json({ error: 'El método de pago ya no tiene saldo disponible' });

      // ── Validar límites financieros ──
      const saldoPendienteFactura = Number(factura.saldo_pendiente);
      const saldoDisponiblePago   = Number(pago.saldo_disponible);

      if (monto_aplicado > saldoDisponiblePago) {
        return res.status(422).json({
          error: `El monto aplicado (Q${monto_aplicado.toFixed(2)}) excede el saldo disponible del pago (Q${saldoDisponiblePago.toFixed(2)})`,
          saldo_disponible_pago: saldoDisponiblePago
        });
      }

      if (monto_aplicado > saldoPendienteFactura) {
        return res.status(422).json({
          error: `El monto aplicado (Q${monto_aplicado.toFixed(2)}) excede el saldo pendiente de la factura (Q${saldoPendienteFactura.toFixed(2)})`,
          saldo_pendiente_factura: saldoPendienteFactura
        });
      }

      // ── Insertar conciliación (los triggers actualizan facturas y metodos_pago) ──
      const { data, error: cErr } = await supabase
        .from('conciliaciones')
        .insert([{
          factura_id,
          metodo_pago_id,
          monto_aplicado: Number(monto_aplicado),
          fecha_conciliacion: fecha_conciliacion || new Date().toISOString().split('T')[0],
          usuario_conciliacion: usuario_email || 'sistema',
          notas: notas || null,
        }])
        .select()
        .single();

      if (cErr) throw cErr;

      // Retornar estado actualizado de ambos registros
      const [{ data: facturaAct }, { data: pagoAct }] = await Promise.all([
        supabase.from('facturas').select('id, estado, monto_pagado, saldo_pendiente').eq('id', factura_id).single(),
        supabase.from('metodos_pago').select('id, estado, saldo_utilizado, saldo_disponible').eq('id', metodo_pago_id).single(),
      ]);

      res.status(201).json({
        success: true,
        conciliacion: data,
        factura_actualizada: facturaAct,
        pago_actualizado: pagoAct,
      });
    } catch (err) {
      console.error('Error en conciliación:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/conciliaciones/batch — conciliar MÚLTIPLES facturas con UN método de pago
  // + opcionalmente aplicar NCRE como ajuste previo al cuadre.
  //
  // Flujo:
  //  1) Si vienen aplicaciones_nc: aplica cada NCRE a su factura objetivo (reduce el pendiente)
  //  2) Distribuye el saldo del método de pago entre las facturas en orden hasta agotar
  router.post('/batch', async (req, res) => {
    try {
      const {
        factura_ids,
        metodo_pago_id,
        fecha_conciliacion,
        usuario_email,
        notas,
        aplicaciones_nc, // [{ nota_credito_id, factura_id, monto_aplicado }]
      } = req.body;

      if (!Array.isArray(factura_ids) || factura_ids.length === 0)
        return res.status(400).json({ error: 'factura_ids debe ser un array no vacío' });
      if (!metodo_pago_id)
        return res.status(400).json({ error: 'metodo_pago_id es requerido' });

      const fechaConc = fecha_conciliacion || new Date().toISOString().split('T')[0];

      // Cargar método de pago
      const { data: pago, error: pErr } = await supabase
        .from('metodos_pago')
        .select('id, estado, saldo_disponible')
        .eq('id', metodo_pago_id)
        .single();
      if (pErr || !pago) return res.status(404).json({ error: 'Método de pago no encontrado' });
      if (pago.estado === 'anulado')         return res.status(409).json({ error: 'El método de pago está anulado' });
      if (pago.estado === 'utilizado_total') return res.status(409).json({ error: 'El método de pago no tiene saldo disponible' });

      // ── 1) Aplicar NCRE (si vienen) ANTES del cuadre con efectivo/cheque ──
      const aplicacionesCreadas = [];
      if (Array.isArray(aplicaciones_nc) && aplicaciones_nc.length > 0) {
        for (const ap of aplicaciones_nc) {
          if (!ap.nota_credito_id || !ap.factura_id || !ap.monto_aplicado || ap.monto_aplicado <= 0) {
            return res.status(400).json({ error: 'Aplicación de NCRE inválida: requiere nota_credito_id, factura_id y monto_aplicado > 0' });
          }

          const { data: app, error: appErr } = await supabase
            .from('aplicaciones_nota_credito')
            .insert([{
              nota_credito_id:    ap.nota_credito_id,
              factura_id:         ap.factura_id,
              monto_aplicado:     Number(ap.monto_aplicado),
              fecha_aplicacion:   fechaConc,
              usuario_aplicacion: usuario_email || 'sistema',
              notas:              ap.notas || null,
            }])
            .select()
            .single();

          if (appErr) {
            return res.status(400).json({ error: `Error aplicando NCRE: ${appErr.message}` });
          }
          aplicacionesCreadas.push(app);
          // El trigger trg_recalcular_factura_por_nc actualiza monto_pagado y estado automáticamente
        }
      }

      // ── 2) Cargar facturas con saldo actualizado y validar ──
      const { data: facturas, error: fErr } = await supabase
        .from('facturas')
        .select('id, nombre_emisor, estado, saldo_pendiente, monto_total, monto_pagado, tipo_documento')
        .in('id', factura_ids);
      if (fErr) throw fErr;

      for (const f of facturas) {
        if (f.tipo_documento === 'nota_credito') {
          return res.status(409).json({ error: 'Las notas de crédito no pueden conciliarse directamente. Usa aplicaciones_nc.' });
        }
        if (f.estado === 'anulada') return res.status(409).json({ error: `Factura de "${f.nombre_emisor}" está anulada` });
        if (f.estado === 'pagada')  continue; // ya pagada (quizá por la NCRE) — la saltamos sin error
      }

      // Ordenar por orden de selección
      const facturaMap = Object.fromEntries(facturas.map(f => [f.id, f]));
      const ordenadas  = factura_ids.map(id => facturaMap[id]).filter(Boolean);

      // Distribuir saldo del método de pago entre las facturas
      let saldoRestante = Number(pago.saldo_disponible);
      const conciliaciones = [];

      for (const f of ordenadas) {
        if (saldoRestante <= 0) break;
        const pendiente = Number(f.saldo_pendiente);
        if (pendiente <= 0) continue;  // ya cubierta (posiblemente por NCRE)
        const montoAplicar = Math.min(saldoRestante, pendiente);

        const { data: conc, error: cErr } = await supabase
          .from('conciliaciones')
          .insert([{
            factura_id:          f.id,
            metodo_pago_id,
            monto_aplicado:      montoAplicar,
            fecha_conciliacion:  fechaConc,
            usuario_conciliacion: usuario_email || 'sistema',
            notas: notas || null,
          }])
          .select()
          .single();

        if (cErr) throw cErr;
        conciliaciones.push(conc);
        saldoRestante -= montoAplicar;
      }

      res.status(201).json({
        success: true,
        total_conciliaciones:    conciliaciones.length,
        total_nc_aplicadas:      aplicacionesCreadas.length,
        conciliaciones,
        aplicaciones_nc:         aplicacionesCreadas,
        saldo_restante_pago:     saldoRestante,
      });
    } catch (err) {
      console.error('Error en conciliación batch:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/conciliaciones/efectivo — crear método de pago tipo efectivo + conciliar en una sola op.
  // No requiere un metodo_pago existente: el pago en efectivo se crea on-the-fly por el monto exacto.
  router.post('/efectivo', async (req, res) => {
    try {
      const {
        factura_ids,
        monto,                  // total a pagar en efectivo (se distribuye entre facturas)
        fecha_pago,
        usuario_email,
        notas,
        aplicaciones_nc,        // opcional: aplicar NCRE primero
        descripcion,
      } = req.body;

      if (!Array.isArray(factura_ids) || factura_ids.length === 0)
        return res.status(400).json({ error: 'factura_ids debe ser un array no vacío' });
      if (!monto || Number(monto) <= 0)
        return res.status(400).json({ error: 'monto debe ser > 0' });

      const fechaPago = fecha_pago || new Date().toISOString().split('T')[0];

      // ── 1) Aplicar NCRE primero si vienen ──
      const aplicacionesCreadas = [];
      if (Array.isArray(aplicaciones_nc) && aplicaciones_nc.length > 0) {
        for (const ap of aplicaciones_nc) {
          if (!ap.nota_credito_id || !ap.factura_id || !ap.monto_aplicado || ap.monto_aplicado <= 0) {
            return res.status(400).json({ error: 'Aplicación de NCRE inválida' });
          }
          const { data: app, error: appErr } = await supabase
            .from('aplicaciones_nota_credito')
            .insert([{
              nota_credito_id:    ap.nota_credito_id,
              factura_id:         ap.factura_id,
              monto_aplicado:     Number(ap.monto_aplicado),
              fecha_aplicacion:   fechaPago,
              usuario_aplicacion: usuario_email || 'sistema',
              notas:              ap.notas || null,
            }])
            .select()
            .single();
          if (appErr) return res.status(400).json({ error: `Error aplicando NCRE: ${appErr.message}` });
          aplicacionesCreadas.push(app);
          // El trigger trg_recalcular_factura_por_nc ya actualiza monto_pagado y estado
        }
      }

      // ── 2) Crear el método de pago tipo 'efectivo' por el monto exacto ──
      const { data: nuevoPago, error: pErr } = await supabase
        .from('metodos_pago')
        .insert([{
          tipo:             'efectivo',
          fecha_documento:  fechaPago,
          monto_inicial:    Number(monto),
          descripcion:      descripcion || 'Pago en efectivo',
          notas:            notas || null,
          origen:           'manual',
          usuario_creacion: usuario_email || 'sistema',
          estado:           'disponible',
        }])
        .select()
        .single();
      if (pErr) throw pErr;

      // ── 3) Conciliar contra las facturas ──
      const { data: facturas, error: fErr } = await supabase
        .from('facturas')
        .select('id, nombre_emisor, estado, saldo_pendiente, tipo_documento')
        .in('id', factura_ids);
      if (fErr) throw fErr;

      for (const f of facturas) {
        if (f.tipo_documento === 'nota_credito')
          return res.status(409).json({ error: 'Las notas de crédito no pueden conciliarse directamente.' });
        if (f.estado === 'anulada')
          return res.status(409).json({ error: `Factura de "${f.nombre_emisor}" está anulada` });
      }

      const facturaMap = Object.fromEntries(facturas.map(f => [f.id, f]));
      const ordenadas  = factura_ids.map(id => facturaMap[id]).filter(Boolean);

      let saldoRestante = Number(monto);
      const conciliaciones = [];

      for (const f of ordenadas) {
        if (saldoRestante <= 0) break;
        const pendiente = Number(f.saldo_pendiente);
        if (pendiente <= 0) continue;
        const montoAplicar = Math.min(saldoRestante, pendiente);

        const { data: conc, error: cErr } = await supabase
          .from('conciliaciones')
          .insert([{
            factura_id:          f.id,
            metodo_pago_id:      nuevoPago.id,
            monto_aplicado:      montoAplicar,
            fecha_conciliacion:  fechaPago,
            usuario_conciliacion: usuario_email || 'sistema',
            notas:               notas || null,
          }])
          .select()
          .single();
        if (cErr) throw cErr;
        conciliaciones.push(conc);
        saldoRestante -= montoAplicar;
      }

      res.status(201).json({
        success: true,
        metodo_pago:           nuevoPago,
        total_conciliaciones:  conciliaciones.length,
        total_nc_aplicadas:    aplicacionesCreadas.length,
        conciliaciones,
        aplicaciones_nc:       aplicacionesCreadas,
        saldo_restante:        saldoRestante,
      });
    } catch (err) {
      console.error('Error en pago efectivo:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/conciliaciones/:id — revertir una conciliación
  router.delete('/:id', async (req, res) => {
    try {
      const { usuario_email } = req.body;

      const { data: conc, error: fetchErr } = await supabase
        .from('conciliaciones')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fetchErr || !conc) return res.status(404).json({ error: 'Conciliación no encontrada' });

      const { error } = await supabase
        .from('conciliaciones')
        .delete()
        .eq('id', req.params.id);
      if (error) throw error;

      res.json({
        success: true,
        message: 'Conciliación revertida. Los saldos de factura y método de pago han sido actualizados.',
        conciliacion_revertida: conc,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/conciliaciones — historial
  router.get('/', async (req, res) => {
    try {
      const { factura_id, metodo_pago_id, desde, hasta, page = 1, limit = 50 } = req.query;

      let query = supabase
        .from('conciliaciones')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (factura_id)     query = query.eq('factura_id', factura_id);
      if (metodo_pago_id) query = query.eq('metodo_pago_id', metodo_pago_id);
      if (desde)          query = query.gte('fecha_conciliacion', desde);
      if (hasta)          query = query.lte('fecha_conciliacion', hasta);

      const { data, error, count } = await query;
      if (error) throw error;
      res.json({ data, total: count, page: Number(page), limit: Number(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/conciliaciones/reporte — vista drilldown completa
  router.get('/reporte', async (req, res) => {
    try {
      const { desde, hasta } = req.query;
      let query = supabase.from('v_conciliacion_detalle').select('*');
      if (desde) query = query.gte('fecha_emision', desde);
      if (hasta) query = query.lte('fecha_emision', hasta);

      const { data, error } = await query;
      if (error) throw error;
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
