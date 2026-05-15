const express = require('express');
const router  = express.Router();

// Endpoints de soporte para la tabla legacy 'transacciones'.
// El sistema activo opera sobre facturas + metodos_pago + conciliaciones,
// pero las páginas Search.jsx y Viewer.jsx del frontend siguen leyendo
// esta tabla. Estos endpoints existen para que el frontend NO use la
// anon key de Supabase directamente (todo el acceso pasa por el backend).

module.exports = (supabase) => {

  // GET /api/transacciones?q=texto
  // Búsqueda parcial sobre beneficiario, raw_ocr y fecha_documento.
  router.get('/', async (req, res) => {
    try {
      const q = (req.query.q || '').trim();
      if (!q) return res.json({ data: [] });

      const like = `%${q}%`;
      const { data, error } = await supabase
        .from('transacciones')
        .select('*')
        .or(`beneficiario.ilike.${like},raw_ocr.ilike.${like},fecha_documento.ilike.${like}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ data: data || [] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/transacciones/:id
  router.get('/:id', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('transacciones')
        .select('*')
        .eq('id', req.params.id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return res.status(404).json({ error: 'Documento no encontrado' });
        throw error;
      }
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/transacciones/:id — actualizar campos editables
  router.patch('/:id', async (req, res) => {
    try {
      const { beneficiario, monto, fecha_documento } = req.body || {};
      const patch = {};
      if (beneficiario    !== undefined) patch.beneficiario    = beneficiario;
      if (fecha_documento !== undefined) patch.fecha_documento = fecha_documento;
      if (monto           !== undefined) patch.monto           = parseFloat(monto) || 0;

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: 'No se enviaron campos a actualizar' });
      }

      const { data, error } = await supabase
        .from('transacciones')
        .update(patch)
        .eq('id', req.params.id)
        .select()
        .single();

      if (error) throw error;
      res.json({ data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
