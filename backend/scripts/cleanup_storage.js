/**
 * Script de limpieza única: elimina archivos huérfanos del bucket 'comprobantes'
 * Conserva solo los archivos referenciados en metodos_pago.url_comprobante
 * Ejecutar: node backend/scripts/cleanup_storage.js
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function cleanup() {
  console.log('🧹 Iniciando limpieza de storage...\n');

  // 1. Obtener todos los archivos en el bucket
  const { data: files, error: listErr } = await supabase.storage
    .from('comprobantes')
    .list('', { limit: 1000 });

  if (listErr) { console.error('Error listando bucket:', listErr.message); process.exit(1); }
  console.log(`📁 Archivos en storage: ${files.length}`);

  // 2. Obtener los nombres de archivo referenciados en la BD (activos)
  const { data: registros, error: dbErr } = await supabase
    .from('metodos_pago')
    .select('url_comprobante')
    .not('url_comprobante', 'is', null);

  if (dbErr) { console.error('Error consultando BD:', dbErr.message); process.exit(1); }

  const nombresActivos = new Set(
    registros
      .map(r => r.url_comprobante?.split('/comprobantes/')[1])
      .filter(Boolean)
  );
  console.log(`✅ Archivos referenciados en BD activa: ${nombresActivos.size}`);
  nombresActivos.forEach(n => console.log(`   → ${n}`));

  // 3. Identificar huérfanos
  const huerfanos = files.filter(f => !nombresActivos.has(f.name));
  console.log(`\n🗑️  Archivos huérfanos a eliminar: ${huerfanos.length}`);

  if (huerfanos.length === 0) {
    console.log('✨ Sin huérfanos. Storage limpio.');
    return;
  }

  // 4. Eliminar en lotes de 20
  const nombres = huerfanos.map(f => f.name);
  const BATCH = 20;
  for (let i = 0; i < nombres.length; i += BATCH) {
    const lote = nombres.slice(i, i + BATCH);
    const { error: delErr } = await supabase.storage.from('comprobantes').remove(lote);
    if (delErr) {
      console.error(`Error eliminando lote ${i / BATCH + 1}:`, delErr.message);
    } else {
      lote.forEach(n => console.log(`   ✓ Eliminado: ${n}`));
    }
  }

  console.log('\n✅ Limpieza completada.');
}

cleanup().catch(err => { console.error('Error fatal:', err); process.exit(1); });
