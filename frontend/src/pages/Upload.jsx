import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, X, AlertTriangle, Trash2, Upload as UploadIcon, Scan } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ImageCropper } from '../components/ImageCropper';
import { ScannerCapture } from '../components/ScannerCapture';
import { useApp } from '../context/AppContext';
import { api, pagosAPI, compressImageForOCR } from '../services/api';

export function Upload() {
  const navigate = useNavigate();
  const { user, showNotification } = useApp();
  const [isUploading,   setIsUploading]   = useState(false);
  const [validationData, setValidationData] = useState(null);
  const [previewImage,  setPreviewImage]  = useState(null);
  const [isSaving,      setIsSaving]      = useState(false);
  const [isDiscarding,  setIsDiscarding]  = useState(false);
  const [discardOpen,   setDiscardOpen]   = useState(false);
  const [activeTab,     setActiveTab]     = useState('upload'); // 'upload' | 'scan'

  const handleCropComplete = async ({ imageBase64, originalFilename }) => {
    if (!imageBase64) {
      showNotification('No se pudo recortar la imagen.', 'error');
      return;
    }
    setIsUploading(true);

    let payloadBase64 = imageBase64;
    let payloadMime   = 'image/png';
    try {
      const compressed = await compressImageForOCR(imageBase64, 'image/png');
      payloadBase64 = compressed.imageBase64;
      payloadMime   = compressed.mimeType;
      if (compressed.finalBytes !== compressed.originalBytes) {
        const mb = (b) => (b / 1024 / 1024).toFixed(2);
        console.log(`📦 Imagen comprimida para OCR: ${mb(compressed.originalBytes)} MB → ${mb(compressed.finalBytes)} MB (${payloadMime})`);
      }
    } catch (e) {
      console.warn('No se pudo comprimir la imagen, enviando original:', e.message);
    }

    setPreviewImage(`data:${payloadMime};base64,${payloadBase64}`);

    try {
      const result = await api.processDocument({
        imageBase64:      payloadBase64,
        originalFilename: payloadMime === 'image/jpeg'
          ? originalFilename.replace(/\.[^.]+$/, '') + '.jpg'
          : originalFilename,
        usuario_email: user?.email || 'sistema@nexus.com',
      });

      if (result.success) {
        showNotification('Documento analizado. Verifica los datos antes de confirmar.', 'success');
        setValidationData(result.data);
      } else {
        showNotification(result.message || result.error || 'Error al procesar el documento', 'error');
        setPreviewImage(null);
      }
    } catch (error) {
      showNotification(error.message || 'Error de conexión con el backend.', 'error');
      setPreviewImage(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleUpdateField = (field, value) => {
    setValidationData(prev => ({ ...prev, [field]: value }));
  };

  const saveValidatedData = async () => {
    setIsSaving(true);
    try {
      // Confirma el borrador: aplica correcciones del usuario y pasa a 'disponible'
      await pagosAPI.confirmar(validationData.id, {
        tipo:             validationData.tipo,
        banco:            validationData.banco,
        numero_documento: validationData.numero_documento,
        fecha_documento:  validationData.fecha_documento,
        monto_inicial:    validationData.monto_inicial,
        descripcion:      validationData.descripcion,
      });
      showNotification('Documento confirmado y disponible para conciliar', 'success');
      navigate('/metodos-pago');
    } catch (error) {
      showNotification(error.message || 'Error al confirmar el registro', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmarDescarte = async () => {
    setIsDiscarding(true);
    try {
      // El registro está en 'borrador' — DELETE acepta ese estado y limpia storage
      await pagosAPI.delete(validationData.id);
      showNotification('Documento descartado y eliminado', 'success');
      setDiscardOpen(false);
      setValidationData(null);
      setPreviewImage(null);
    } catch (e) {
      showNotification('Error al eliminar el documento: ' + e.message, 'error');
    } finally {
      setIsDiscarding(false);
    }
  };

  const inputStyle = 'w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text disabled:opacity-50';

  return (
    <div className="max-w-6xl mx-auto mt-8">
      <h1 className="text-2xl font-semibold mb-2 text-apple-text">OCR — Procesamiento de Documentos</h1>
      <p className="text-sm text-apple-textSecondary mb-6">
        Sube un comprobante, recorta el área importante y verifica los datos extraídos por la IA antes de confirmar.
      </p>

      {validationData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Vista previa */}
          <Card className="p-4 bg-apple-bgSecondary border border-apple-border flex flex-col">
            <h2 className="text-sm font-medium text-apple-textSecondary mb-4">Documento Recortado</h2>
            <div className="flex-1 rounded-lg overflow-hidden bg-apple-bg flex items-center justify-center p-2 border border-apple-border/50">
              <img src={previewImage} alt="Documento Recortado" className="max-w-full max-h-[500px] object-contain" />
            </div>
            {/* Aviso de estado borrador */}
            <div className="mt-3 flex items-start gap-2 px-3 py-2 bg-apple-warning/10 border border-apple-warning/30 rounded-lg">
              <AlertTriangle size={14} className="text-apple-warning shrink-0 mt-0.5" />
              <p className="text-xs text-apple-warning">
                Este documento aún no está guardado. Confirma los datos o descártalo.
              </p>
            </div>
          </Card>

          {/* Formulario de validación */}
          <Card className="p-6 bg-apple-bgSecondary border border-apple-border">
            <h2 className="text-lg font-medium text-apple-text mb-1">Validar Datos Extraídos</h2>
            <p className="text-xs text-apple-textSecondary mb-5">
              Revisa y corrige si la IA cometió algún error antes de confirmar.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-apple-textSecondary mb-1">Tipo de Documento</label>
                  <select
                    className={inputStyle}
                    value={validationData.tipo}
                    onChange={e => handleUpdateField('tipo', e.target.value)}
                  >
                    {['cheque', 'transferencia', 'deposito', 'efectivo', 'anticipo', 'otro'].map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-apple-textSecondary mb-1">Fecha</label>
                  <input
                    type="date"
                    className={inputStyle}
                    value={validationData.fecha_documento || ''}
                    onChange={e => handleUpdateField('fecha_documento', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-apple-textSecondary mb-1">Banco Emisor / Receptor</label>
                <input
                  type="text"
                  className={inputStyle}
                  value={validationData.banco || ''}
                  onChange={e => handleUpdateField('banco', e.target.value)}
                  placeholder="Ej. Banco Industrial"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-apple-textSecondary mb-1">Número de Referencia / Cheque</label>
                <input
                  type="text"
                  className={inputStyle}
                  value={validationData.numero_documento || ''}
                  onChange={e => handleUpdateField('numero_documento', e.target.value)}
                  placeholder="Ej. #00063470"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-apple-textSecondary mb-1">Monto (Q)</label>
                <input
                  type="number"
                  step="0.01"
                  className={inputStyle}
                  value={validationData.monto_inicial || ''}
                  onChange={e => handleUpdateField('monto_inicial', e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-apple-textSecondary mb-1">Descripción / Beneficiario</label>
                <textarea
                  className={`${inputStyle} resize-none`}
                  rows={3}
                  value={validationData.descripcion || ''}
                  onChange={e => handleUpdateField('descripcion', e.target.value)}
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-apple-border">
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5 text-apple-error border-apple-error/40 hover:bg-apple-error/10"
                  onClick={() => setDiscardOpen(true)}
                  disabled={isSaving || isDiscarding}
                >
                  <Trash2 size={14} /> Descartar
                </Button>
                <Button
                  className="flex-1 gap-1.5"
                  onClick={saveValidatedData}
                  disabled={isSaving || isDiscarding}
                >
                  {isSaving
                    ? <><Loader2 size={14} className="animate-spin" /> Guardando...</>
                    : <><Check size={14} /> Confirmar y Guardar</>}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="p-0 bg-apple-bgSecondary border border-apple-border overflow-hidden">
          {isUploading ? (
            <div className="flex flex-col items-center justify-center h-64">
              <Loader2 size={48} className="animate-spin text-apple-accent" />
              <h3 className="text-lg font-medium mt-4 text-apple-text">La IA está analizando el documento...</h3>
              <p className="text-sm text-apple-textSecondary">Esto puede tomar hasta un minuto.</p>
            </div>
          ) : (
            <>
              {/* ── Tabs: Subir archivo vs Escanear ───────── */}
              <div className="flex bg-apple-bg p-2 gap-2 border-b border-apple-border">
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-apple ${
                    activeTab === 'upload'
                      ? 'bg-apple-accent text-white shadow-md'
                      : 'text-apple-textSecondary hover:text-apple-text hover:bg-apple-bgSecondary'
                  }`}
                >
                  <UploadIcon size={16} />
                  Subir archivo
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('scan')}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-semibold transition-apple ${
                    activeTab === 'scan'
                      ? 'bg-apple-accent text-white shadow-md'
                      : 'text-apple-textSecondary hover:text-apple-text hover:bg-apple-bgSecondary'
                  }`}
                >
                  <Scan size={16} />
                  Escanear documento
                </button>
              </div>

              {/* ── Indicador visible del modo actual (cache buster v2) ── */}
              <div className="px-6 pt-4 pb-2 text-xs text-apple-textSecondary flex items-center gap-2 border-b border-apple-border/40">
                Modo activo:{' '}
                <span className="font-mono px-2 py-0.5 rounded bg-apple-bg text-apple-accent">
                  {activeTab === 'upload' ? '📁 SUBIDA DE ARCHIVO' : '🖨️ ESCANER DIRECTO'}
                </span>
              </div>

              {/* ── Contenido de la tab activa ────────────── */}
              <div className="p-6">
                {activeTab === 'upload' ? (
                  <ImageCropper onCropComplete={handleCropComplete} />
                ) : (
                  <ScannerCapture onScanComplete={handleCropComplete} />
                )}
              </div>
            </>
          )}
        </Card>
      )}

      {/* Modal de confirmación de descarte */}
      <Modal open={discardOpen} onClose={() => setDiscardOpen(false)} title="Descartar Documento" width="max-w-sm">
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-apple-error/10 border border-apple-error/30 rounded-apple">
            <AlertTriangle size={18} className="text-apple-error shrink-0 mt-0.5" />
            <p className="text-sm text-apple-text">
              Se eliminará permanentemente el registro y el archivo de comprobante. Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setDiscardOpen(false)} disabled={isDiscarding}>
              Cancelar
            </Button>
            <Button
              className="gap-1.5 bg-apple-error hover:bg-apple-error/80 border-apple-error"
              onClick={confirmarDescarte}
              disabled={isDiscarding}
            >
              {isDiscarding
                ? <><Loader2 size={14} className="animate-spin" /> Eliminando...</>
                : <><Trash2 size={14} /> Sí, descartar</>}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
