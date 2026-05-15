const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ─── Supabase ───────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── Google Gemini ──────────────────────────────────────────
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'TU_API_KEY_AQUI') {
  console.warn('⚠️  GEMINI_API_KEY no configurada. El OCR fallará hasta que la pegues en backend/.env');
}
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// ─── Middleware ─────────────────────────────────────────────
app.use(cors());
// Aumentar el límite para aceptar imágenes base64 del frontend
app.use(express.json({ limit: '20mb' })); 

// ─── Rutas del nuevo sistema financiero ─────────────────────
const facturasRouter       = require('./routes/facturas')(supabase);
const metodosPagoRouter    = require('./routes/metodosPago')(supabase);
const conciliacionesRouter = require('./routes/conciliaciones')(supabase);
const importacionRouter    = require('./routes/importacionExcel')(supabase);
const adminRouter          = require('./routes/admin')(supabase);
const scannerRouter        = require('./routes/scanner')();

app.use('/api/facturas',          facturasRouter);
app.use('/api/metodos-pago',      metodosPagoRouter);
app.use('/api/conciliaciones',    conciliacionesRouter);
app.use('/api/importacion-excel', importacionRouter);
app.use('/api/admin',             adminRouter);
app.use('/api/scanner',           scannerRouter);

// ─── Health check ───────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    project: 'NEXUS DOC AI SUITE',
    version: '2.1.0', // Versión actualizada
    modules: ['facturas', 'metodos-pago', 'conciliaciones', 'importacion-excel', 'admin', 'scanner-wia', `ocr-${GEMINI_MODEL}`],
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

    // ─── PASO 1: IA Multimodal (ANTES de tocar storage) ────────────────────
    console.log(`🤖 Analizando imagen con ${GEMINI_MODEL}...`);
    const prompt = `
Eres un OCR experto en documentos financieros de GUATEMALA, ESPECIALIZADO EN LECTURA DE ESCRITURA A MANO en cheques. Transcribe LITERALMENTE lo que ves. NO inventes datos, NO traduzcas, NO calcules. Responde EXCLUSIVAMENTE con un JSON válido, sin markdown.

═══════════════════════════════════════════════
CONTEXTO PAÍS — GUATEMALA
═══════════════════════════════════════════════
• Moneda: QUETZAL (símbolos: "Q", "Q.", "GTQ"). Jamás pesos, dólares, soles ni euros.
• Bancos del país: BANRURAL, BANCO INDUSTRIAL, BAM (Banco Agromercantil), BANCO G&T CONTINENTAL, BANTRAB, BANCO PROMERICA, BANCO DE LOS TRABAJADORES, BAC CREDOMATIC, BANCO DE AMÉRICA CENTRAL, INTERBANCO, FICOHSA, VIVIBANCO, BANCO INMOBILIARIO, CITIBANK GUATEMALA.
• Fechas en español: enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre. Formatos: 'dd/mm/yyyy' o 'Guatemala, DÍA de MES YYYY'.
• Cheques: contienen "Cheque No.", "Páguese a la orden de", "Suma de" (monto en letras), y al lado un cuadro con "Q" + monto numérico.
• Transferencias / depósitos digitales: muestran "Cuenta origen", "Cuenta destino", "Monto a transferir", "No. Ref:", "# Ref:", "No. Boleta", "No. Operación".

═══════════════════════════════════════════════
CHEQUES MANUSCRITOS — ATENCIÓN ESPECIAL
═══════════════════════════════════════════════
En Guatemala los cheques son llenados A MANO con bolígrafo. La letra puede ser cursiva, imprenta o mezcla. APLICA ESTAS REGLAS:

1. CAMPOS MANUSCRITOS típicos: beneficiario, fecha, monto en números, monto en letras, firma (la firma NO se transcribe).

2. PARTES PRE-IMPRESAS (en TIPOGRAFÍA): nombre del banco, "Cheque No." + número, "Páguese a la orden de", "Suma de", "Q", líneas de relleno. ESTO ES TEXTO IMPRESO, lee con normalidad.

3. CRUCE-VERIFICACIÓN DEL MONTO (regla #1 anti-error):
   El monto numérico (la mano puede tener un "2" mal cerrado que parezca "7", un "1" que parezca "7", un "0" que parezca "6", o ceros decimales tachados).
   SIEMPRE verifica el monto contra el MONTO EN LETRAS manuscrito:
   • "quinientos veinticinco" → 525.00, NUNCA 5,250 ni 52.50
   • "un mil trescientos" → 1300.00
   • "tres mil quinientos exactos" → 3500.00
   • "cincuenta y dos quetzales con cincuenta centavos" → 52.50
   • Si las letras dicen 525 pero los números parecen 5250, CONFÍA EN LAS LETRAS.

4. NÚMEROS MANUSCRITOS — ambigüedades comunes en Guatemala:
   • "1" sin patita y "7" sin barra horizontal — usa contexto del monto en letras.
   • "Ø" (cero cruzado, estilo europeo) = 0, NO ø ni Ø.
   • "5" abierto arriba puede parecer "S" — siempre es 5.
   • Decimales: a veces escriben "00/100" en lugar de ".00".
   • Comas y puntos de miles: "1,500.00" o "1.500,00" — usa el monto en letras para resolver.

5. NOMBRES MANUSCRITOS de beneficiarios:
   • Pueden estar en cursiva o imprenta. Acepta tildes y mayúsculas mezcladas.
   • Si el nombre es ilegible o solo se ve una firma, devuelve "" (vacío) en beneficiario.
   • NO inventes nombres si no estás seguro.

6. FECHAS MANUSCRITAS:
   • Suelen ir en "Guatemala, DD de MES YYYY" con DD y YYYY a mano y "de", "Guatemala," impresos.
   • A veces escriben con dos dígitos el año ("17" en lugar de "2017") — si es ambiguo, copia tal cual.

═══════════════════════════════════════════════
ESTRUCTURA JSON OBLIGATORIA
═══════════════════════════════════════════════
{
  "beneficiario": "Nombre del beneficiario o receptor. En cheques manuscritos: lee la línea junto a 'Páguese a la orden de'. En transferencias digitales: 'Cuenta destino'. Si está ilegible, devuelve ''.",
  "fecha": "Copia EXACTA del texto de fecha tal como aparece. Ejemplos: 'Guatemala, 4 de julio del 2017', '10/05/2026', '15/03/2026 14:30:22'. NO conviertas formato.",
  "monto": "Valor numérico final. SIEMPRE cruza con el monto en letras para resolver ambigüedades manuscritas. Formato: SIN comas de miles, con PUNTO decimal. Ejemplos correctos: '525.00', '1300.00', '52.50'. INCORRECTO: '1.300' (esto sería mil trescientos pero parece 1.30).",
  "monto_en_letras": "Texto literal del monto en letras, manuscrito en cheques. Ejemplos: 'Quinientos veinticinco quetzales exactos', 'Un mil trescientos quetzales con 00/100'. Si no existe (transferencias), devuelve ''.",
  "banco": "Nombre del banco emisor visible en el logo / cabecera (es texto IMPRESO, fácil de leer). USA un nombre exacto de la lista de bancos arriba. Ej: 'BANRURAL', 'BANCO INDUSTRIAL'.",
  "numero_documento": "Correlativo del documento. En cheques: junto a 'Cheque No.' (texto IMPRESO, no confundir con el monto). En transferencias: '# Ref:', 'No. Operación', 'No. Boleta'. Solo dígitos. Ej: '0000001', '995500221'.",
  "tipo": "EXACTAMENTE uno de: 'cheque' | 'transferencia' | 'deposito' | 'efectivo'. Reglas: 'Cheque No.' o documento de bolsillo con firma → 'cheque'. 'Cuenta destino' / 'transferir' → 'transferencia'. 'Depósito monetario' / 'Boleta' → 'deposito'. 'Recibo de caja' → 'efectivo'."
}

═══════════════════════════════════════════════
REGLAS CRÍTICAS FINALES
═══════════════════════════════════════════════
1. Si un campo no se ve o no se entiende, devuélvelo como "" — JAMÁS inventes.
2. NO traduzcas nombres propios ni razones sociales.
3. NO conviertas formato de fecha — cópialo LITERAL.
4. Monto SIEMPRE en formato '0000.00' (punto decimal, sin separador de miles).
5. En CHEQUES, el monto en letras es la verdad absoluta. Si choca con los dígitos manuscritos, RESPETA las letras.
`;

    // Detectar mimeType desde los primeros bytes del buffer (PNG, JPEG, WebP)
    const detectMime = (buf) => {
      if (buf.length < 12) return 'image/png';
      if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
      if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
      if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
          && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
      return 'image/png';
    };
    const mimeType = detectMime(imageBuffer);

    let datosEstructurados = {};
    let tokensUsage = { prompt: null, respuesta: null, total: null };
    try {

      const aiResponse = await genAI.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          { role: 'user', parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ]},
        ],
        config: {
          temperature: 0.0,
          responseMimeType: 'application/json',
        },
      });

      const responseText = aiResponse.text || '';
      if (!responseText) throw new Error('Gemini devolvió respuesta vacía');

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      datosEstructurados = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

      // Capturar consumo de tokens reportado por Gemini para auditoría/costos
      const usage = aiResponse.usageMetadata || {};
      tokensUsage = {
        prompt:    usage.promptTokenCount     ?? null,
        respuesta: usage.candidatesTokenCount ?? null,
        total:     usage.totalTokenCount      ?? null,
      };

      console.log(`✅ Datos extraídos por ${GEMINI_MODEL} — tokens: ${tokensUsage.total} (prompt: ${tokensUsage.prompt}, respuesta: ${tokensUsage.respuesta})`);

    } catch (e) {
      console.error(`❌ Error procesando con ${GEMINI_MODEL}:`, e.message);
      return res.status(500).json({ error: `Error con Gemini: ${e.message}` });
    }

    // Limpieza inteligente del campo monto para evitar bugs con "Q."
    let montoRaw = String(datosEstructurados.monto || '0');
    // Buscamos explícitamente el bloque de números (ej evita el punto inicial de "Q.")
    // \d+ obliga a que empiece con un número, y luego agarra puntos, comas y más números
    const matchNumero = montoRaw.match(/\d+[\d,.]*/);
    if (matchNumero) {
      let numeroLimpio = matchNumero[0];
      // El modelo a veces usa punto como separador de miles: "1.300.00".
      // La regla humana: un punto o coma seguido de exactamente 3 cifras y luego otro separador (o final) es separador de miles.
      numeroLimpio = numeroLimpio.replace(/[.,](?=\d{3}(?:[.,]|$))/g, '');
      // Si quedó alguna coma funcionando como decimal (ej: "1300,50"), la pasamos a punto matemático estándar
      numeroLimpio = numeroLimpio.replace(/,/g, '.');
      montoRaw = numeroLimpio;
    } else {
      montoRaw = '0';
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
    
    // Convertir la fecha a formato de base de datos
    const fechaAnalizada = parseFechaOCR(datosEstructurados.fecha);
    if (!fechaAnalizada) {
      throw new Error(`La Inteligencia Artificial no pudo extraer o procesar una fecha del documento (Leyó: "${datosEstructurados.fecha}"). No se puede continuar sin el día de emisión.`);
    }

    // Limpiar el número de documento: quitar ceros a la izquierda y truncar a 100 caracteres max para evitar crash
    let numeroDocLimpio = datosEstructurados.numero_documento ? String(datosEstructurados.numero_documento).trim() : null;
    if (numeroDocLimpio) {
      numeroDocLimpio = numeroDocLimpio.replace(/^0+(?=\d)/, ''); // Quita los ceros a la izquierda
      numeroDocLimpio = numeroDocLimpio.substring(0, 100);        // Trunca a 100 caracteres máximo
    }

    // Truncar también el banco por seguridad
    let bancoLimpio = datosEstructurados.banco ? String(datosEstructurados.banco).trim() : null;
    if (bancoLimpio) {
      bancoLimpio = bancoLimpio.substring(0, 100);
    }
    
    // ─── PASO 2: Validación de duplicados (ANTES de tocar storage) ─────────
    if (tipoDocumento === 'cheque' && numeroDocLimpio && bancoLimpio) {
      const dbMonto = montoFinal > 0 ? montoFinal : 1;
      const { data: existentes, error: errorBusqueda } = await supabase
        .from('metodos_pago')
        .select('id')
        .eq('tipo', 'cheque')
        .eq('numero_documento', numeroDocLimpio)
        .eq('banco', bancoLimpio)
        .eq('monto_inicial', dbMonto)
        .not('estado', 'eq', 'borrador')
        .limit(1);

      if (!errorBusqueda && existentes && existentes.length > 0) {
        throw new Error(`ESTE CHEQUE YA FUE INGRESADO ANTERIORMENTE. (Coincide banco: ${bancoLimpio}, número: ${numeroDocLimpio} y monto: Q${dbMonto}). Acción denegada por seguridad.`);
      }
    }

    // ─── PASO 3: Subir a Storage SOLO si OCR + validaciones pasaron ─────────
    // Sanitizar el nombre: quitar espacios, caracteres especiales, mantener extensión
    const sanitizeFilename = (name) => {
      const lastDot = name.lastIndexOf('.');
      const ext = lastDot > -1 ? name.substring(lastDot).toLowerCase() : '';
      const base = (lastDot > -1 ? name.substring(0, lastDot) : name)
        .replace(/[^\w-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '')
        .substring(0, 80);
      return `${base}${ext}`;
    };
    const fileName = `${Date.now()}_${sanitizeFilename(originalFilename)}`;
    const { error: storageError } = await supabase.storage
      .from('comprobantes')
      .upload(fileName, imageBuffer, { contentType: mimeType });
    if (storageError) throw storageError;

    const { data: { publicUrl } } = supabase.storage
      .from('comprobantes')
      .getPublicUrl(fileName);

    // ─── PASO 4: Insertar en BD como BORRADOR — si falla, rollback storage ──
    // Estado 'borrador': NO aparece como fondo disponible hasta que el usuario
    // confirme los datos en el frontend. Si cancela, DELETE limpia BD + storage.
    const { data: dbData, error: dbError } = await supabase
      .from('metodos_pago')
      .insert([{
        tipo:             tipoDocumento,
        banco:            bancoLimpio,
        numero_documento: numeroDocLimpio,
        fecha_documento:  fechaAnalizada,
        monto_inicial:    montoFinal > 0 ? montoFinal : 1,
        descripcion:      `${datosEstructurados.beneficiario || 'N/A'}. Monto en letras: ${datosEstructurados.monto_en_letras || 'N/A'}`,
        url_comprobante:  publicUrl,
        raw_ocr:          JSON.stringify(datosEstructurados),
        file_hash:        fileHash,
        origen:           'ocr_upload',
        usuario_creacion: correoUsuarioFinal,
        estado:           'borrador',
        // Auditoría de uso del modelo
        tokens_prompt:    tokensUsage.prompt,
        tokens_respuesta: tokensUsage.respuesta,
        tokens_total:     tokensUsage.total,
        ocr_modelo:       GEMINI_MODEL,
      }])
      .select()
      .single();

    if (dbError) {
      await supabase.storage.from('comprobantes').remove([fileName]);
      console.error('❌ Error en BD, archivo de storage eliminado:', fileName);
      throw dbError;
    }

    console.log('✅ OCR exitoso → guardado como BORRADOR (pendiente confirmación del usuario)');
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
  console.log(`\n🚀 NEXUS DOC AI SUITE v2.1 listo en http://localhost:${port}`);
  console.log(`   Módulos activos: facturas | metodos-pago | conciliaciones | importacion-excel | admin`);
  console.log(`   OCR: ${GEMINI_MODEL} (Google Gemini API)`);
});
