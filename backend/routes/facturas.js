const express = require('express');
const router = express.Router();

module.exports = (supabase) => {

  // GET /api/facturas — listar con filtros
  router.get('/', async (req, res) => {
    try {
      const {
        estado, estados, busqueda, tipo_documento, nit_emisor, id_receptor,
        desde, hasta, origen, page = 1, limit = 50
      } = req.query;

      let query = supabase
        .from('facturas')
        .select('*', { count: 'exact' })
        .order('fecha_emision', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      // estados=pendiente,parcial  OR  estado=pendiente (single)
      if (estados)        query = query.in('estado', estados.split(',').map(s => s.trim()));
      else if (estado)    query = query.eq('estado', estado);
      if (tipo_documento) query = query.eq('tipo_documento', tipo_documento);
      if (nit_emisor)     query = query.ilike('nit_emisor', `%${nit_emisor}%`);
      if (id_receptor)    query = query.ilike('id_receptor', `%${id_receptor}%`);
      if (origen)         query = query.eq('origen', origen);
      if (desde)          query = query.gte('fecha_emision', desde);
      if (hasta)          query = query.lte('fecha_emision', hasta);
      if (busqueda)       query = query.or(`nombre_emisor.ilike.%${busqueda}%,nombre_receptor.ilike.%${busqueda}%,nit_emisor.ilike.%${busqueda}%,numero_autorizacion.ilike.%${busqueda}%`);

      const { data, error, count } = await query;
      if (error) throw error;

      res.json({ data, total: count, page: Number(page), limit: Number(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/facturas/reporte/control-pagos — todas las facturas + conciliaciones para reporte del contador
  // DEBE ir antes de /:id para evitar que Express capture 'reporte' como un id
  router.get('/reporte/control-pagos', async (req, res) => {
    try {
      const { desde, hasta, estado, origen } = req.query;

      let fQuery = supabase
        .from('facturas')
        .select('*')
        .order('fecha_emision', { ascending: false });

      if (desde)  fQuery = fQuery.gte('fecha_emision', desde);
      if (hasta)  fQuery = fQuery.lte('fecha_emision', hasta);
      if (estado) fQuery = fQuery.eq('estado', estado);
      if (origen) fQuery = fQuery.eq('origen', origen);

      const { data: facturas, error: fErr } = await fQuery;
      if (fErr) throw fErr;

      if (!facturas.length) return res.json({ facturas: [], conciliaciones: [] });

      const facturaIds = facturas.map(f => f.id);

      const { data: conciliaciones, error: cErr } = await supabase
        .from('v_conciliacion_detalle')
        .select('factura_id, conciliacion_id, monto_aplicado, fecha_conciliacion, usuario_conciliacion, tipo_pago, banco, numero_cheque_o_referencia, fecha_pago, estado_pago')
        .in('factura_id', facturaIds)
        .not('conciliacion_id', 'is', null);

      if (cErr) throw cErr;

      res.json({ facturas, conciliaciones: conciliaciones || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/facturas/reporte/resumen — métricas del dashboard
  router.get('/reporte/resumen', async (req, res) => {
    try {
      const { desde, hasta } = req.query;

      let query = supabase.from('facturas').select('estado, monto_total, monto_pagado, saldo_pendiente');
      if (desde) query = query.gte('fecha_emision', desde);
      if (hasta) query = query.lte('fecha_emision', hasta);

      const { data, error } = await query;
      if (error) throw error;

      const resumen = data.reduce((acc, f) => {
        acc.total++;
        acc.monto_total     += Number(f.monto_total)     || 0;
        acc.monto_pagado    += Number(f.monto_pagado)    || 0;
        acc.saldo_pendiente += Number(f.saldo_pendiente) || 0;
        acc[`estado_${f.estado}`] = (acc[`estado_${f.estado}`] || 0) + 1;
        return acc;
      }, { total: 0, monto_total: 0, monto_pagado: 0, saldo_pendiente: 0 });

      res.json(resumen);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/facturas/:id — detalle con conciliaciones (drill-down)
  router.get('/:id', async (req, res) => {
    try {
      const { data: factura, error: fErr } = await supabase
        .from('facturas')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (fErr) throw fErr;

      const { data: conciliaciones, error: cErr } = await supabase
        .from('v_conciliacion_detalle')
        .select('*')
        .eq('factura_id', req.params.id);
      if (cErr) throw cErr;

      res.json({ factura, conciliaciones });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // POST /api/facturas — crear manualmente
  router.post('/', async (req, res) => {
    try {
      const { usuario_email, ...payload } = req.body;
      const { data, error } = await supabase
        .from('facturas')
        .insert([{ ...payload, usuario_creacion: usuario_email || 'manual', origen: 'manual' }])
        .select()
        .single();
      if (error) throw error;
      res.status(201).json({ success: true, data });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // PATCH /api/facturas/:id — actualizar (notas, tipo_documento, anular)
  router.patch('/:id', async (req, res) => {
    try {
      const camposPermitidos = ['notas', 'tipo_documento', 'estado', 'nombre_receptor', 'id_receptor'];
      const payload = {};
      camposPermitidos.forEach(c => { if (req.body[c] !== undefined) payload[c] = req.body[c]; });

      const { data, error } = await supabase
        .from('facturas')
        .update(payload)
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
