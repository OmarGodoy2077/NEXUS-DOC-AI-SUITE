import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Check, X } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ImageCropper } from '../components/ImageCropper';
import { useApp } from '../context/AppContext';
import { api, pagosAPI } from '../services/api';

export function Upload() {
  const navigate = useNavigate();
  const { user, showNotification } = useApp();
  const [isUploading, setIsUploading] = useState(false);
  const [validationData, setValidationData] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleCropComplete = async ({ imageBase64, originalFilename }) => {
    if (!imageBase64) {
      showNotification('No se pudo recortar la imagen.', 'error');
      return;
    }
    setIsUploading(true);
    setPreviewImage(`data:image/png;base64,${imageBase64}`);

    try {
      const result = await api.processDocument({
        imageBase64,
        originalFilename,
        usuario_email: user?.email || 'sistema@nexus.com',
      });

      if (result.success) {
        showNotification('Documento analizado. Verifica los datos.', 'success');
        setValidationData(result.data); // result.data es el registro en metodos_pago
      } else {
        showNotification(result.message || result.error || 'Error al procesar el documento', 'error');
        setPreviewImage(null);
      }
    } catch (error) {
      console.error('Error OCR:', error);
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
      await pagosAPI.update(validationData.id, {
        tipo: validationData.tipo,
        banco: validationData.banco,
        numero_documento: validationData.numero_documento,
        fecha_documento: validationData.fecha_documento,
        monto_inicial: validationData.monto_inicial,
        descripcion: validationData.descripcion
      });
      showNotification('Datos actualizados y validados correctamente', 'success');
      navigate('/metodos-pago');
    } catch (error) {
      showNotification(error.message || 'Error al actualizar el registro', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const discardAndCancel = async () => {
    if (!confirm('¿Descartar este documento?')) return;
    try {
      // Intentamos anular/eliminar para limpiar la base de datos si ya se insertó
      await pagosAPI.anular(validationData.id);
      await pagosAPI.delete(validationData.id);
    } catch (e) {
      console.warn('Error limpiando el registro cancelado', e);
    }
    setValidationData(null);
    setPreviewImage(null);
  };

  const inputStyle = 'w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text disabled:opacity-50';

  return (
    <div className="max-w-6xl mx-auto mt-8">
      <h1 className="text-2xl font-semibold mb-2 text-apple-text">OCR — Procesamiento de Documentos</h1>
      <p className="text-sm text-apple-textSecondary mb-6">
        Sube un comprobante, recorta el área importante y verifica los datos extraídos por la IA antes de finalizar.
      </p>

      {validationData ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Vista previa del documento recortado */}
          <Card className="p-4 bg-apple-bgSecondary border border-apple-border flex flex-col">
            <h2 className="text-sm font-medium text-apple-textSecondary mb-4">Documento Recortado</h2>
            <div className="flex-1 rounded-lg overflow-hidden bg-apple-bg flex items-center justify-center p-2 border border-apple-border/50">
              <img src={previewImage} alt="Documento Recortado" className="max-w-full max-h-[500px] object-contain" />
            </div>
          </Card>

          {/* Formulario de Validación */}
          <Card className="p-6 bg-apple-bgSecondary border border-apple-border">
            <h2 className="text-lg font-medium text-apple-text mb-4">Validar Datos Extraídos</h2>
            <p className="text-xs text-apple-warning mb-6">
              Revisa y corrige los datos si la IA cometió algún error al interpretar la imagen.
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
                  variant="secondary" 
                  className="flex-1" 
                  onClick={discardAndCancel}
                  disabled={isSaving}
                >
                  <X size={16} className="mr-2" /> Descartar
                </Button>
                <Button 
                  variant="primary" 
                  className="flex-1" 
                  onClick={saveValidatedData}
                  disabled={isSaving}
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin mr-2" /> : <Check size={16} className="mr-2" />}
                  Confirmar y Guardar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <Card className="p-6 bg-apple-bgSecondary border border-apple-border">
          {isUploading ? (
            <div className="flex flex-col items-center justify-center h-64">
              <Loader2 size={48} className="animate-spin text-apple-accent" />
              <h3 className="text-lg font-medium mt-4 text-apple-text">
                La IA está analizando el documento...
              </h3>
              <p className="text-sm text-apple-textSecondary">
                Esto puede tomar hasta un minuto.
              </p>
            </div>
          ) : (
            <ImageCropper onCropComplete={handleCropComplete} />
          )}
        </Card>
      )}
    </div>
  );
}
