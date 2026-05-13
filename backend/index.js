const express = require('express');
const cors = require('cors');
const multer = require('multer');
// Tesseract.js ya no es necesario
// const Tesseract = require('tesseract.js'); 
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ─── Supabase ───────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── Middleware ─────────────────────────────────────────────
app.use(cors());
// Aumentar el límite para aceptar imágenes base64 del frontend
app.use(express.json({ limit: '20mb' })); 

// ─── Rutas del nuevo sistema financiero ─────────────────────
const facturasRouter       = require('./routes/facturas')(supabase);
const metodosPagoRouter    = require('./routes/metodosPago')(supabase);
const conciliacionesRouter = require('./routes/conciliaciones')(supabase);
const importacionRouter    = require('./routes/importacionExcel')(supabase);

app.use('/api/facturas',          facturasRouter);
app.use('/api/metodos-pago',      metodosPagoRouter);
app.use('/api/conciliaciones',    conciliacionesRouter);
app.use('/api/importacion-excel', importacionRouter);

// ─── Health check ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    project: 'NEXUS DOC AI SUITE',
    version: '2.1.0', // Versión actualizada
    modules: ['facturas', 'metodos-pago', 'conciliaciones', 'importacion-excel', 'ocr-llava'],
  });
});

// ─── OCR: Procesamiento de documentos con LLaVA ──────────────────
// Multer para el archivo original (fallback o auditoría)
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/process-document', upload.single('document'), async (req, res) => {
  try {
    // La imagen ahora viene en el body como base64, el archivo es opcional
    const { imageBase64, originalFilename, usuario_email } = req.body;

    if (!imageBase64 || !originalFilename) {
      return res.status(400).json({ error: 'No se proporcionó imagen o nombre de archivo.' });
    }

    console.log(`\n🚀 Recibiendo para OCR: ${originalFilename}`);
    
    // Convertir base64 a buffer para hashing y subida
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const fileHash = crypto.createHash('md5').update(imageBuffer).digest('hex');

    // Verificar duplicado en metodos_pago, ignorando los que estén anulados
    const { data: existente } = await supabase
      .from('metodos_pago')
      .select('*')
      .eq('file_hash', fileHash)
      .neq('estado', 'anulado')
      .limit(1)
      .maybeSingle();

    if (existente) {
      console.log('⚠️ Documento ya procesado y no está anulado.');
      return res.json({ success: true, data: existente, message: 'Este documento ya existe y no está anulado.' });
    }

    // ─── PASO 1: IA Multimodal con MiniCPM-V (antes de subir a storage) ─────
    console.log('🤖 Analizando imagen con MiniCPM-V...');
    const prompt = `
      Eres una herramienta de extracción OCR estricta. Transcribe EXACTAMENTE lo que ves en la imagen. NO inventes palabras, no intentes hacer cálculos ni transformes formatos. Responde ÚNICAMENTE con un JSON válido, sin bloques de código ni texto adicional.

      Utiliza estrictamente esta estructura y sigue el ejemplo de lo que debes buscar:
      {
        "beneficiario": "El nombre literal junto a 'Pago a la orden de:' (Ej: 'José Fasselli')",
        "fecha": "Copia el texto de la fecha tal como está escrito (Ej: 'Guatemala, 4 de Julio 2017')",
        "monto": "El valor numérico final del cheque. CRUCIAL: Lee atentamente la cantidad escrita en letras (ej: 'Un mil trescientos') para confirmar la magnitud (miles, cientos, etc.) y evitar errores de decimales. Escribe el número SIN comas de miles y usando PUNTO exclusivamente para los decimales (Ej: '1300.00' y NO '1.300').",
        "monto_en_letras": "El texto literal junto a 'Suma de:' (Ej: 'Un mil trescientos quetzales exactos')",
        "banco": "El nombre de la institución del logo (Ej: 'BANCO INDUSTRIAL')",
        "numero_documento": "El código debajo de la frase 'Cheque No.' (Ej: '0000001'). Ojo: ESTE ES EL CORRELATIVO DEL DOCUMENTO, NO EL DINERO.",
        "tipo": "Define de qué trata. Si lees explícitamente la palabra 'cheque' (ej: 'Cheque No.'), el valor debe ser ESTRICTAMENTE 'cheque'. Mismo caso para 'transferencia' o 'deposito'."
      }
    `;

    let datosEstructurados = {};
    try {
      const aiResponse = await fetch('http://localhost:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'minicpm-v',
          prompt: prompt,
          images: [imageBase64],
          stream: false,
          format: 'json',
          options: { temperature: 0.0 }
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!aiResponse.ok) {
        const errorBody = await aiResponse.text();
        throw new Error(`Error de MiniCPM-V: ${aiResponse.status} ${errorBody}`);
      }

      const aiData = await aiResponse.json();
      const jsonMatch = aiData.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        datosEstructurados = JSON.parse(jsonMatch[0]);
      } else {
        datosEstructurados = JSON.parse(aiData.response);
      }
      console.log('✅ Datos extraídos por MiniCPM-V:', datosEstructurados);

    } catch (e) {
      console.error('❌ Error procesando con MiniCPM-V:', e.message);
      return res.status(500).json({ error: `Error con el modelo MiniCPM-V: ${e.message}` });
    }

    // ─── PASO 2: Validaciones y limpieza de datos (antes de tocar storage) ──
    const matchNumero = String(datosEstructurados.monto || '0').match(/\d+[\d,.]*/);
    let montoRaw = '0';
    if (matchNumero) {
      let n = matchNumero[0].replace(/[.,](?=\d{3}(?:[.,]|$))/g, '').replace(/,/g, '.');
      montoRaw = n;
    }
    const montoFinal = parseFloat(montoRaw) || 0;

    const correoUsuarioFinal = usuario_email || 'sistema@nexus.com';

    const tiposValidos = ['cheque', 'transferencia', 'deposito', 'efectivo', 'anticipo'];
    let tipoParseado = (datosEstructurados.tipo || 'otro').toLowerCase().trim();
    if (!tiposValidos.includes(tipoParseado)) {
      if (tipoParseado.includes('cheque')) tipoParseado = 'cheque';
      else if (tipoParseado.includes('transf')) tipoParseado = 'transferencia';
      else if (tipoParseado.includes('deposi')) tipoParseado = 'deposito';
      else tipoParseado = 'otro';
    }
    const tipoDocumento = tipoParseado;

    const fechaAnalizada = parseFechaOCR(datosEstructurados.fecha);
    if (!fechaAnalizada) {
      throw new Error(`La Inteligencia Artificial no pudo extraer o procesar una fecha del documento (Leyó: "${datosEstructurados.fecha}"). No se puede continuar sin el día de emisión.`);
    }

    let numeroDocLimpio = datosEstructurados.numero_documento ? String(datosEstructurados.numero_documento).trim() : null;
    if (numeroDocLimpio) {
      numeroDocLimpio = numeroDocLimpio.replace(/^0+(?=\d)/, '').substring(0, 100);
    }

    let bancoLimpio = datosEstructurados.banco ? String(datosEstructurados.banco).trim().substring(0, 100) : null;

    if (tipoDocumento === 'cheque' && numeroDocLimpio && bancoLimpio) {
      const dbMonto = montoFinal > 0 ? montoFinal : 1;
      const { data: existentes, error: errorBusqueda } = await supabase
        .from('metodos_pago')
        .select('id')
        .eq('tipo', 'cheque')
        .eq('numero_documento', numeroDocLimpio)
        .eq('banco', bancoLimpio)
        .eq('monto_inicial', dbMonto)
        .limit(1);

      if (!errorBusqueda && existentes && existentes.length > 0) {
        throw new Error(`ESTE CHEQUE YA FUE INGRESADO ANTERIORMENTE. (Coincide banco: ${bancoLimpio}, número: ${numeroDocLimpio} y monto: Q${dbMonto}). Acción denegada por seguridad.`);
      }
    }

    // ─── PASO 3: Subir a Storage SOLO si todas las validaciones pasaron ──────
    const fileName = `${Date.now()}_${originalFilename}`;
    const { error: storageError } = await supabase.storage
      .from('comprobantes')
      .upload(fileName, imageBuffer, { contentType: 'image/png' });
    if (storageError) throw storageError;

    const { data: { publicUrl } } = supabase.storage
      .from('comprobantes')
      .getPublicUrl(fileName);

    // ─── PASO 4: Guardar en BD — si falla, limpiar storage inmediatamente ───
    const { data: dbData, error: dbError } = await supabase
      .from('metodos_pago')
      .insert([{
        tipo:             tipoDocumento,
        banco:            bancoLimpio,
        numero_documento: numeroDocLimpio,
        fecha_documento:  fechaAnalizada,
        monto_inicial:    montoFinal > 0 ? montoFinal : 1,
        descripcion:      `Cheque para: ${datosEstructurados.beneficiario || 'N/A'}. Monto en letras: ${datosEstructurados.monto_en_letras || 'N/A'}`,
        url_comprobante:  publicUrl,
        raw_ocr:          JSON.stringify(datosEstructurados),
        file_hash:        fileHash,
        origen:           'ocr_upload',
        usuario_creacion: correoUsuarioFinal,
      }])
      .select()
      .single();

    if (dbError) {
      // Rollback: eliminar el archivo recién subido para no dejar huérfanos
      await supabase.storage.from('comprobantes').remove([fileName]);
      console.error('❌ Error en BD, archivo de storage eliminado:', fileName);
      throw dbError;
    }

    console.log('✅ Proceso OCR exitoso → guardado en metodos_pago');
    res.json({ success: true, data: dbData });

  } catch (error) {
    console.error('\n❌ ERROR GENERAL:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Función auxiliar para parsear fechas
function parseFechaOCR(fechaStr) {
  if (!fechaStr || typeof fechaStr !== 'string' || fechaStr.trim() === '') {
    return null; // Si no hay fecha, fallará en BD intencionalmente para forzar validación manual
  }

  // Si la IA ya hizo el trabajo y devolvió YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr.trim())) {
    return fechaStr.trim();
  }

  const meses = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };

    try {
    // Intentar extraer si viene mezclado con texto adicional (ej. "Guatemala, 4 de julio 2017" o "21 de marzo del 2020")
    const fechaNormalizada = fechaStr.toLowerCase().replace(/,/g, '').trim();
    // Soporta: " de ", " del ", o solo un espacio antes del año.
    const regex = /(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de\s+|\s+del\s+|\s+)(\d{4})/;
    const match = fechaNormalizada.match(regex);

    if (match) {
      const [, dia, mes, anio] = match;
      if (meses[mes]) {
        const fechaISO = `${anio}-${meses[mes]}-${dia.padStart(2, '0')}`;
        return fechaISO;
      }
    }

    // Último recurso con el parser nativo
    const date = new Date(fechaStr);
    if (!isNaN(date.getTime())) {
      date.setUTCDate(date.getUTCDate() + 1);
      return date.toISOString().split('T')[0];
    }
  } catch (e) {
    console.error(`Error crítico al parsear la fecha: "${fechaStr}"`, e);
  }
  
  return null;
}


// ─── Métricas Dashboard ─────────────────────────────────────
app.get('/api/metrics', async (req, res) => {
  try {
    const [
      { count: totalFacturas },
      { count: facturasPendientes },
      { data: montoData },
      { count: totalPagos },
    ] = await Promise.all([
      supabase.from('facturas').select('id', { count: 'exact', head: true }),
      supabase.from('facturas').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
      supabase.from('facturas').select('monto_total, monto_pagado, saldo_pendiente'),
      supabase.from('metodos_pago').select('id', { count: 'exact', head: true }),
    ]);

    const totales = (montoData || []).reduce((acc, f) => ({
      monto_total:     acc.monto_total     + Number(f.monto_total),
      monto_pagado:    acc.monto_pagado    + Number(f.monto_pagado),
      saldo_pendiente: acc.saldo_pendiente + Number(f.saldo_pendiente),
    }), { monto_total: 0, monto_pagado: 0, saldo_pendiente: 0 });

    res.json({
      total_facturas:     totalFacturas,
      facturas_pendientes: facturasPendientes,
      total_metodos_pago: totalPagos,
      ...totales,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Error handler global ───────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(port, () => {
  console.log(`\n🚀 NEXUS DOC AI SUITE v2.0 listo en http://localhost:${port}`);
  console.log('   Módulos activos: facturas | metodos-pago | conciliaciones | importacion-excel | OCR');
});
