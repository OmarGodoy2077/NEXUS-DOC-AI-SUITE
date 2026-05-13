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
