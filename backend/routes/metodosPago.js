const express = require('express');
const router = express.Router();

module.exports = (supabase) => {

  // GET /api/metodos-pago — listar con filtros
  router.get('/', async (req, res) => {
    try {
      const { tipo, estado, banco, desde, hasta, page = 1, limit = 50 } = req.query;

      let query = supabase
        .from('metodos_pago')
        .select('*', { count: 'exact' })
        .order('fecha_documento', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (tipo)   query = query.eq('tipo', tipo);
      if (estado) query = query.eq('estado', estado);
      if (banco)  query = query.ilike('banco', `%${banco}%`);
      if (desde)  query = query.gte('fecha_documento', desde);
      if (hasta)  query = query.lte('fecha_documento', hasta);

      const { data, error, count } = await query;
      if (error) throw error;

      res.json({ data, total: count, page: Number(page), limit: Number(limit) });
    } catch (err) {
      res.status(500).json({ error: err.message }); 
    }
  });

  // GET /api/metodos-pago/disponibles — sólo los que tienen saldo_disponible > 0
  router.get('/disponibles', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('metodos_pago')
        .select('*')
        .in('estado', ['disponible', 'utilizado_parcial'])
        .order('fecha_documento', { ascending: false });
      if (error) throw error;
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/metodos-pago/:id — detalle con conciliaciones vinculadas
  router.get('/:id', async (req, res) => {
    try {
      const { data: pago, error: pErr } = await supabase
        .from('metodos_pago')
        .select('*')
        .eq('id', req.params.id)
        .single();
      if (pErr) throw pErr;

      const { data: conciliaciones, error: cErr } = await supabase
        .from('v_conciliacion_detalle')
        .select('factura_id, numero_autorizacion, nombre_emisor, monto_total, monto_aplicado, fecha_conciliacion')
        .eq('metodo_pago_id', req.params.id);
      if (cErr) throw cErr;

      res.json({ pago, conciliaciones });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // POST /api/metodos-pago — registrar nuevo pago (manual)
  router.post('/', async (req, res) => {
    try {
      const { usuario_email, ...payload } = req.body;

      if (!payload.tipo)            return res.status(400).json({ error: 'tipo es requerido' });
      if (!payload.fecha_documento) return res.status(400).json({ error: 'fecha_documento es requerida' });
      if (!payload.monto_inicial || payload.monto_inicial <= 0)
        return res.status(400).json({ error: 'monto_inicial debe ser mayor a 0' });

      const { data, error } = await supabase
        .from('metodos_pago')
        .insert([{ ...payload, usuario_creacion: usuario_email || 'manual', origen: 'manual' }])
        .select()
        .single();
      if (error) throw error;

      res.status(201).json({ success: true, data });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // PATCH /api/metodos-pago/:id — actualizar notas, banco, número de documento, tipo, fecha, monto
  router.patch('/:id', async (req, res) => {
    try {
      const camposPermitidos = ['tipo', 'banco', 'numero_documento', 'fecha_documento', 'monto_inicial', 'descripcion', 'notas', 'url_comprobante'];
      const payload = {};
      camposPermitidos.forEach(c => { if (req.body[c] !== undefined) payload[c] = req.body[c]; });

      const { data, error } = await supabase
        .from('metodos_pago')
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

  // POST /api/metodos-pago/:id/confirmar — borrador → disponible (usuario aprueba los datos OCR)
  router.post('/:id/confirmar', async (req, res) => {
    try {
      const { data: mPago, error: fetchErr } = await supabase
        .from('metodos_pago')
        .select('estado')
        .eq('id', req.params.id)
        .single();

      if (fetchErr || !mPago) return res.status(404).json({ error: 'Registro no encontrado' });
      if (mPago.estado !== 'borrador') {
        return res.status(400).json({ error: 'Solo se puede confirmar un registro en estado borrador' });
      }

      // Aplicar los campos editados que el usuario haya corregido + cambiar estado a disponible
      const camposPermitidos = ['tipo', 'banco', 'numero_documento', 'fecha_documento', 'monto_inicial', 'descripcion'];
      const payload = { estado: 'disponible' };
      camposPermitidos.forEach(c => { if (req.body[c] !== undefined) payload[c] = req.body[c]; });

      const { data, error } = await supabase
        .from('metodos_pago')
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

  // POST /api/metodos-pago/:id/anular
  router.post('/:id/anular', async (req, res) => {
    try {
      const { count, error: cErr } = await supabase
        .from('conciliaciones')
        .select('id', { count: 'exact', head: true })
        .eq('metodo_pago_id', req.params.id);
      if (cErr) throw cErr;

      if (count > 0) {
        return res.status(409).json({
          error: `No se puede anular: tiene ${count} conciliación(es) activa(s). Revírtelas primero.`
        });
      }

      const { data, error } = await supabase
        .from('metodos_pago')
        .update({ estado: 'anulado' })
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/metodos-pago/:id — eliminar registro anulado y su archivo en storage
  router.delete('/:id', async (req, res) => {
    try {
      const { data: mPago, error: fetchErr } = await supabase
        .from('metodos_pago')
        .select('estado, url_comprobante')
        .eq('id', req.params.id)
        .single();

      if (fetchErr) throw fetchErr;

      if (!['anulado', 'borrador'].includes(mPago.estado)) {
        return res.status(400).json({ error: 'Solo se pueden eliminar registros en estado ANULADO o BORRADOR.' });
      }

      // Eliminar archivo de storage si existe.
      // IMPORTANTE: getPublicUrl() devuelve la URL con URL-encoding (espacios → %20),
      // pero el storage espera el nombre del archivo DECODIFICADO para borrar.
      let storageDeleted = false;
      let storageFileName = null;
      if (mPago.url_comprobante) {
        const rawName = mPago.url_comprobante.split('/comprobantes/')[1];
        if (rawName) {
          storageFileName = decodeURIComponent(rawName);
          const { data: removed, error: storageErr } = await supabase.storage
            .from('comprobantes')
            .remove([storageFileName]);
          if (storageErr) {
            console.error('⚠️ Error eliminando archivo de storage:', storageErr.message);
          } else if (removed && removed.length > 0) {
            storageDeleted = true;
            console.log('🗑️ Archivo eliminado de storage:', storageFileName);
          } else {
            console.warn('⚠️ Storage no encontró el archivo:', storageFileName);
          }
        }
      }

      const { error: delErr } = await supabase
        .from('metodos_pago')
        .delete()
        .eq('id', req.params.id);

      if (delErr) throw delErr;

      res.json({
        success: true,
        message: 'Registro eliminado correctamente.',
        storage_file_deleted: storageDeleted,
        storage_file_name: storageFileName,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
