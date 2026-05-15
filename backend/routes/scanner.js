const express = require('express');
const router = express.Router();
const scannerService = require('../services/scannerService');

// Rate limit simple en memoria: max 30 requests por IP por minuto
// (protege contra abuse del scanner que es un recurso lento y costoso)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  record.count++;
  rateLimitMap.set(ip, record);

  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Demasiadas peticiones al scanner. Intenta de nuevo en un minuto.',
    });
  }
  next();
}

// GET /api/scanner/list — Listar scanners disponibles
router.get('/list', rateLimit, async (req, res) => {
  try {
    const result = await scannerService.listScanners();
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('Error listando scanners:', err.code, err.message);
    const status = err.code === 'PLATFORM_NOT_SUPPORTED' ? 501 : 500;
    res.status(status).json({
      error: err.message,
      code:  err.code || 'UNKNOWN',
    });
  }
});

// GET /api/scanner/constants — Devolver constantes válidas (DPI range, color modes)
router.get('/constants', (req, res) => {
  res.json({
    success:   true,
    constants: scannerService.CONSTANTS,
  });
});

// POST /api/scanner/scan — Iniciar escaneo de un documento
// Body: { deviceId, dpi?, colorMode? }
router.post('/scan', rateLimit, async (req, res) => {
  try {
    const { deviceId, dpi, colorMode } = req.body || {};

    const result = await scannerService.scanDocument({
      deviceId,
      dpi,
      colorMode,
    });

    res.json({
      success: true,
      data:    result,
    });
  } catch (err) {
    console.error('Error escaneando:', err.code, err.message);
    let status = 500;
    if (err.code === 'INVALID_DEVICE_ID' || err.code === 'INVALID_DPI' || err.code === 'INVALID_COLOR_MODE') {
      status = 400;
    } else if (err.code === 'DEVICE_NOT_FOUND') {
      status = 404;
    } else if (err.code === 'TIMEOUT') {
      status = 504;
    } else if (err.code === 'PLATFORM_NOT_SUPPORTED') {
      status = 501;
    }
    res.status(status).json({
      error: err.message,
      code:  err.code || 'UNKNOWN',
    });
  }
});

module.exports = () => router;
