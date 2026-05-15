import React, { useState, useEffect, useCallback } from 'react';
import { Scan, RefreshCw, Loader2, AlertTriangle, CheckCircle2, Printer, Wifi, Usb } from 'lucide-react';
import { Button } from './ui/Button';
import { scannerAPI } from '../services/api';

/**
 * ScannerCapture
 *
 * Componente que permite:
 *   1. Detectar scanners conectados al servidor (USB / red).
 *   2. Seleccionar uno.
 *   3. Configurar DPI y modo de color.
 *   4. Disparar el escaneo y devolver la imagen base64 al padre.
 *
 * Props:
 *   onScanComplete({ imageBase64, originalFilename }): callback cuando termina el scan
 */
export function ScannerCapture({ onScanComplete }) {
  const [scanners,         setScanners]         = useState([]);
  const [loadingList,      setLoadingList]      = useState(true);
  const [listError,        setListError]        = useState(null);
  const [selectedId,       setSelectedId]       = useState('');
  const [dpi,              setDpi]              = useState(200);
  const [colorMode,        setColorMode]        = useState('Color');
  const [scanning,         setScanning]         = useState(false);
  const [scanError,        setScanError]        = useState(null);
  const [previewSrc,       setPreviewSrc]       = useState(null);

  const loadScanners = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await scannerAPI.list();
      const list = res.scanners || [];
      setScanners(list);
      // Auto-seleccionar el primero si hay alguno y aún no hay selección
      if (list.length > 0) {
        setSelectedId(prev => prev || list[0].id);
      }
    } catch (e) {
      setListError(e.message || 'Error al listar scanners');
      setScanners([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Cargar scanners al montar el componente
  useEffect(() => {
    loadScanners();
  }, [loadScanners]);

  const handleScan = async () => {
    if (!selectedId) return;
    setScanning(true);
    setScanError(null);
    setPreviewSrc(null);
    try {
      const res = await scannerAPI.scan({
        deviceId:  selectedId,
        dpi,
        colorMode,
      });
      const { base64, mimeType, filename } = res.data;
      // Mostrar preview en el componente
      setPreviewSrc(`data:${mimeType};base64,${base64}`);
      // Notificar al padre para que continúe el flujo OCR
      onScanComplete({
        imageBase64:      base64,
        originalFilename: filename || `scan_${Date.now()}.jpg`,
      });
    } catch (e) {
      setScanError(e.message || 'Error durante el escaneo');
    } finally {
      setScanning(false);
    }
  };

  const selectCls = 'w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text disabled:opacity-50';

  return (
    <div className="space-y-4">
      {/* ── Header descriptivo de la sección ───────────────── */}
      <div className="flex items-center gap-3 pb-3 border-b border-apple-border">
        <div className="p-2 bg-apple-accent/10 rounded-lg text-apple-accent">
          <Scan size={18} />
        </div>
        <div>
          <p className="text-sm font-medium text-apple-text">Captura directa con scanner</p>
          <p className="text-xs text-apple-textSecondary">
            Detecta automáticamente scanners USB y de red conectados al servidor
          </p>
        </div>
      </div>

      {/* ── Selector de scanner ────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-apple-textSecondary">
            Scanner detectado{scanners.length !== 1 ? 's' : ''}
            {scanners.length > 0 && (
              <span className="ml-1.5 text-apple-textSecondary">({scanners.length})</span>
            )}
          </label>
          <button
            onClick={loadScanners}
            disabled={loadingList || scanning}
            className="flex items-center gap-1 text-xs text-apple-accent hover:underline disabled:opacity-50"
          >
            <RefreshCw size={11} className={loadingList ? 'animate-spin' : ''} />
            Buscar otra vez
          </button>
        </div>

        {loadingList ? (
          <div className="flex items-center justify-center py-8 text-apple-textSecondary text-sm">
            <Loader2 size={16} className="animate-spin mr-2" />
            Buscando scanners...
          </div>
        ) : listError ? (
          <div className="flex items-start gap-3 p-3 bg-apple-error/10 border border-apple-error/30 rounded-apple">
            <AlertTriangle size={16} className="text-apple-error shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-apple-error">No se pudieron listar los scanners</p>
              <p className="text-xs text-apple-textSecondary mt-0.5">{listError}</p>
            </div>
          </div>
        ) : scanners.length === 0 ? (
          <div className="flex items-start gap-3 p-3 bg-apple-warning/10 border border-apple-warning/30 rounded-apple">
            <AlertTriangle size={16} className="text-apple-warning shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-apple-warning">No se detectaron scanners</p>
              <p className="text-xs text-apple-textSecondary mt-1">
                Verifica que tu scanner (Epson, HP, Brother, etc.) esté:
              </p>
              <ul className="text-xs text-apple-textSecondary list-disc list-inside mt-0.5 space-y-0.5">
                <li>Encendido y conectado por USB o red</li>
                <li>Reconocido en Configuración → Bluetooth y dispositivos → Impresoras y escáneres</li>
                <li>Con sus drivers WIA instalados</li>
              </ul>
            </div>
          </div>
        ) : (
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            disabled={scanning}
            className={selectCls}
          >
            {scanners.map(s => (
              <option key={s.id} value={s.id}>
                {s.name || s.description} {s.manufacturer ? `— ${s.manufacturer}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* ── Opciones de escaneo ────────────────────────────── */}
      {scanners.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-apple-textSecondary block mb-1">
              Resolución (DPI)
            </label>
            <select
              value={dpi}
              onChange={e => setDpi(Number(e.target.value))}
              disabled={scanning}
              className={selectCls}
            >
              <option value={150}>150 — Borrador</option>
              <option value={200}>200 — Estándar</option>
              <option value={300}>300 — Alta</option>
              <option value={400}>400 — Muy alta</option>
              <option value={600}>600 — Máxima</option>
            </select>
            <p className="text-[10px] text-apple-textSecondary mt-1">
              200 DPI funciona bien para OCR de cheques y facturas
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-apple-textSecondary block mb-1">
              Modo de color
            </label>
            <select
              value={colorMode}
              onChange={e => setColorMode(e.target.value)}
              disabled={scanning}
              className={selectCls}
            >
              <option value="Color">Color</option>
              <option value="Grayscale">Escala de grises</option>
              <option value="BW">Blanco y negro</option>
            </select>
            <p className="text-[10px] text-apple-textSecondary mt-1">
              Color mejora la precisión del OCR
            </p>
          </div>
        </div>
      )}

      {/* ── Error de escaneo ───────────────────────────────── */}
      {scanError && (
        <div className="flex items-start gap-3 p-3 bg-apple-error/10 border border-apple-error/30 rounded-apple">
          <AlertTriangle size={16} className="text-apple-error shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-apple-error">Error durante el escaneo</p>
            <p className="text-xs text-apple-textSecondary mt-0.5">{scanError}</p>
          </div>
        </div>
      )}

      {/* ── Preview de la captura ──────────────────────────── */}
      {previewSrc && !scanning && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-apple-success">
            <CheckCircle2 size={14} /> Documento escaneado · enviando al OCR...
          </div>
          <div className="rounded-apple overflow-hidden border border-apple-border bg-apple-bg flex items-center justify-center p-2">
            <img
              src={previewSrc}
              alt="Documento escaneado"
              className="max-w-full max-h-72 object-contain"
            />
          </div>
        </div>
      )}

      {/* ── Botón de escaneo ───────────────────────────────── */}
      {scanners.length > 0 && (
        <Button
          onClick={handleScan}
          disabled={!selectedId || scanning}
          className="w-full gap-2"
        >
          {scanning
            ? <><Loader2 size={16} className="animate-spin" /> Escaneando... (esto puede tomar 30-60 segundos)</>
            : <><Scan size={16} /> Escanear Documento</>}
        </Button>
      )}

      {/* ── Ayuda contextual ───────────────────────────────── */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-apple-textSecondary border-t border-apple-border pt-3">
        <span className="flex items-center gap-1"><Usb size={11} /> USB</span>
        <span className="flex items-center gap-1"><Wifi size={11} /> Red</span>
        <span className="flex items-center gap-1"><Printer size={11} /> Multifunción</span>
      </div>
    </div>
  );
}
