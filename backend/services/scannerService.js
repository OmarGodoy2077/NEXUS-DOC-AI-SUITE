/**
 * scannerService.js
 *
 * Servicio puente entre Node.js y los scanners del sistema operativo (Windows).
 * Usa WIA (Windows Image Acquisition) via PowerShell para listar y capturar.
 *
 * Soporta:
 *   - Scanners USB (Epson L200, HP, Canon, Brother, etc.)
 *   - Scanners de red detectables por WIA
 *   - Impresoras multifunción con scanner
 *
 * Seguridad:
 *   - Solo expone métodos validados, NUNCA construye comandos PowerShell por concatenación
 *   - Todos los parámetros pasan por flags `-Param value` (no inyectable)
 *   - Archivos temporales se borran tras enviar al cliente
 *   - Validación estricta de tipos en cada parámetro
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const crypto = require('crypto');

const PS_SCRIPT = path.join(__dirname, 'scanner-wia.ps1');

// Constantes de validación
const VALID_COLOR_MODES = ['Color', 'Grayscale', 'BW'];
const MIN_DPI = 75;
const MAX_DPI = 600;
const DEFAULT_DPI = 200;
const SCAN_TIMEOUT_MS = 120_000;  // 2 min máx por scan
const LIST_TIMEOUT_MS = 10_000;   // 10s para listar

class ScannerError extends Error {
  constructor(message, code = 'SCANNER_ERROR', cause) {
    super(message);
    this.name = 'ScannerError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * Ejecuta el script PowerShell con argumentos seguros (sin shell, sin interpolación).
 * Retorna el JSON parseado o lanza ScannerError.
 */
function execPowerShell(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', PS_SCRIPT,
      ...args,
    ];

    execFile('powershell.exe', psArgs, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,  // 50 MB para imágenes grandes
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed && err.signal === 'SIGTERM') {
          return reject(new ScannerError('Timeout: el scanner tardó demasiado en responder', 'TIMEOUT'));
        }
        return reject(new ScannerError(
          `Error ejecutando PowerShell: ${stderr || err.message}`,
          'POWERSHELL_ERROR',
          err
        ));
      }

      const trimmed = (stdout || '').trim();
      if (!trimmed) {
        return reject(new ScannerError('PowerShell no devolvió ninguna salida', 'EMPTY_OUTPUT'));
      }

      try {
        const result = JSON.parse(trimmed);
        if (!result.success) {
          return reject(new ScannerError(result.error || 'Error desconocido', result.code || 'PS_REPORTED_ERROR'));
        }
        resolve(result);
      } catch (parseErr) {
        reject(new ScannerError(
          `Salida inválida del script: ${trimmed.substring(0, 200)}`,
          'PARSE_ERROR',
          parseErr
        ));
      }
    });
  });
}

/**
 * Lista todos los scanners disponibles en el sistema.
 * @returns {Promise<{count: number, scanners: Array<{id, name, manufacturer, description}>}>}
 */
async function listScanners() {
  if (process.platform !== 'win32') {
    throw new ScannerError(
      'El módulo de scanner solo está soportado en Windows actualmente',
      'PLATFORM_NOT_SUPPORTED'
    );
  }

  const result = await execPowerShell(['-Mode', 'list'], LIST_TIMEOUT_MS);
  return {
    count:    result.count    || 0,
    scanners: result.scanners || [],
  };
}

/**
 * Valida los parámetros antes de pasarlos al script.
 * Lanza ScannerError si algo es inválido.
 */
function validateScanParams({ deviceId, dpi, colorMode }) {
  if (!deviceId || typeof deviceId !== 'string') {
    throw new ScannerError('deviceId es requerido y debe ser string', 'INVALID_DEVICE_ID');
  }
  // Los DeviceID de WIA son tipo "\\.\Usbscan0\..." — verificamos que no tenga caracteres maliciosos
  // No permitimos saltos de línea, comillas, ni semicolons (defensa profunda).
  if (/[\n\r'"`;]/.test(deviceId)) {
    throw new ScannerError('deviceId contiene caracteres no permitidos', 'INVALID_DEVICE_ID');
  }
  const dpiNum = Number(dpi);
  if (!Number.isInteger(dpiNum) || dpiNum < MIN_DPI || dpiNum > MAX_DPI) {
    throw new ScannerError(
      `DPI debe ser entero entre ${MIN_DPI} y ${MAX_DPI}`,
      'INVALID_DPI'
    );
  }
  if (!VALID_COLOR_MODES.includes(colorMode)) {
    throw new ScannerError(
      `colorMode debe ser uno de: ${VALID_COLOR_MODES.join(', ')}`,
      'INVALID_COLOR_MODE'
    );
  }
  return { deviceId, dpi: dpiNum, colorMode };
}

/**
 * Escanea un documento.
 * Retorna { base64, mimeType, sizeBytes, dpi, colorMode } y limpia el archivo temporal.
 */
async function scanDocument(params) {
  if (process.platform !== 'win32') {
    throw new ScannerError(
      'El módulo de scanner solo está soportado en Windows actualmente',
      'PLATFORM_NOT_SUPPORTED'
    );
  }

  const { deviceId, dpi, colorMode } = validateScanParams({
    deviceId:  params.deviceId,
    dpi:       params.dpi       ?? DEFAULT_DPI,
    colorMode: params.colorMode ?? 'Color',
  });

  // Archivo temporal con nombre aleatorio para evitar colisiones / race conditions
  const tempName = `nexus_scan_${Date.now()}_${crypto.randomBytes(8).toString('hex')}.jpg`;
  const tempPath = path.join(os.tmpdir(), tempName);

  try {
    await execPowerShell([
      '-Mode',      'scan',
      '-DeviceId',  deviceId,
      '-OutputPath', tempPath,
      '-Dpi',       String(dpi),
      '-ColorMode', colorMode,
    ], SCAN_TIMEOUT_MS);

    // Leer el archivo escaneado y convertirlo a base64
    const buffer = await fs.readFile(tempPath);
    const base64 = buffer.toString('base64');
    const stats  = await fs.stat(tempPath);

    return {
      base64,
      mimeType:  'image/jpeg',
      sizeBytes: stats.size,
      dpi,
      colorMode,
      filename: `scan_${Date.now()}.jpg`,
    };
  } finally {
    // Limpiar archivo temporal sin importar éxito o error
    try {
      if (fsSync.existsSync(tempPath)) {
        await fs.unlink(tempPath);
      }
    } catch (cleanupErr) {
      console.warn('No se pudo eliminar archivo temporal:', tempPath, cleanupErr.message);
    }
  }
}

module.exports = {
  listScanners,
  scanDocument,
  ScannerError,
  // Exportar constantes para que el frontend pueda mostrar los rangos válidos
  CONSTANTS: {
    VALID_COLOR_MODES,
    MIN_DPI,
    MAX_DPI,
    DEFAULT_DPI,
  },
};
