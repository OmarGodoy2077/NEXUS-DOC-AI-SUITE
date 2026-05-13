import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Edit2, Download, FileText, History, User as UserIcon, Bot, Server, Loader2, X } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { createClient } from '@supabase/supabase-js';

// Conexión a Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export function Viewer() {
  const { id } = useParams();
  const navigate = useNavigate();
  
  // Estados de carga y datos originales
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('extracted');

  // NUEVOS ESTADOS PARA EDICIÓN Y GUARDADO
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadDoc = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('transacciones')
          .select('*')
          .eq('id', id)
          .single();

        if (error) throw error;
        setDoc(data);
        // Inicializamos los datos editables con lo que trajo la base de datos
        setEditedData({
          beneficiario: data.beneficiario,
          monto: data.monto,
          fecha_documento: data.fecha_documento
        });
      } catch (error) {
        console.error("Error cargando documento:", error.message);
        alert("Error cargando el documento de la base de datos.");
      } finally {
        setLoading(false);
      }
    };

    if (id) loadDoc();
  }, [id]);

  // --- LÓGICA DE LOS BOTONES ---

  // 1. Descargar: Abre la URL de Supabase Storage
  const handleDownload = () => {
    if (doc?.url_archivo) {
      window.open(doc.url_archivo, '_blank');
    }
  };

  // 2. Validar y Guardar: Actualiza PostgreSQL
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('transacciones')
        .update({
          beneficiario: editedData.beneficiario,
          monto: parseFloat(editedData.monto) || 0, // Aseguramos que el monto sea numérico
          fecha_documento: editedData.fecha_documento
        })
        .eq('id', id);

      if (error) throw error;
      
      console.log("✅ Documento actualizado y validado correctamente");
      // Volvemos al Dashboard general
      navigate('/dashboard'); 
    } catch (error) {
      console.error("❌ Error al guardar:", error.message);
      alert("Hubo un error al guardar los cambios.");
    } finally {
      setIsSaving(false);
    }
  };

  const auditTrail = doc ? [
    { id: 1, event: 'Carga de archivo', actor: doc.usuario_email || 'Desconocido', time: new Date(doc.created_at).toLocaleString(), icon: UserIcon },
    { id: 2, event: 'Extracción OCR (Tesseract Local)', actor: 'NEXUS Backend', time: new Date(doc.created_at).toLocaleString(), icon: Server },
    { id: 3, event: 'Estructuración AI (Llama 3.2)', actor: 'AI Engine', time: new Date(doc.created_at).toLocaleString(), icon: Bot },
  ] : [];

  if (loading) return <LoadingSpinner className="h-[80vh]" text="Conectando a base de datos..." />;
  if (!doc) return <div className="p-8 text-center text-apple-textSecondary">Documento no encontrado.</div>;

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Documento Financiero</h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="success">Procesado con IA</Badge>
              {isEditing && <Badge variant="warning" className="bg-yellow-500/20 text-yellow-500 border-yellow-500/50">Modo Edición</Badge>}
            </div>
          </div>
        </div>
        
        {/* BOTONERA SUPERIOR ACTUALIZADA */}
        <div className="flex gap-2">
          {/* Botón de Corregir / Cancelar */}
          <Button 
            variant="outline" 
            onClick={() => {
              setIsEditing(!isEditing);
              // Si cancela, regresamos los valores a como estaban originalmente
              if (isEditing) setEditedData({ beneficiario: doc.beneficiario, monto: doc.monto, fecha_documento: doc.fecha_documento });
            }}
          >
            {isEditing ? <><X size={16} className="mr-2" /> Cancelar Edición</> : <><Edit2 size={16} className="mr-2" /> Corregir</>}
          </Button>
          
          {/* Botón de Descargar */}
          <Button variant="outline" onClick={handleDownload}>
            <Download size={16} className="mr-2" /> Descargar
          </Button>
          
          {/* Botón de Validar y Guardar */}
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Check size={16} className="mr-2" />}
            {isSaving ? 'Guardando...' : 'Validar y Guardar'}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Lado PDF Original */}
        <Card className="flex-1 flex flex-col bg-[#1e1e1e] p-0 overflow-hidden border-0 relative">
          <div className="h-10 bg-apple-bgSecondary flex items-center px-4 border-b border-apple-border text-sm font-medium z-10">
            Documento Original
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden bg-black/40">
            {doc.url_archivo ? (
              <img src={doc.url_archivo} alt="Documento escaneado" className="w-full h-full object-contain p-4"/>
            ) : (
              <div className="text-white/50 flex flex-col items-center gap-2"><FileText size={48} /><p>Archivo no disponible</p></div>
            )}
          </div>
        </Card>

        {/* Lado Datos Extraídos y Auditoría */}
        <Card className="flex-1 flex flex-col p-0 overflow-hidden">
          <div className="flex border-b border-apple-border bg-apple-bgSecondary">
            {['extracted', 'raw', 'audit'].map(tab => (
              <button 
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-apple ${activeTab === tab ? 'border-apple-accent text-apple-accent bg-apple-bg' : 'border-transparent text-apple-textSecondary hover:text-apple-text'}`}
              >
                {tab === 'extracted' ? 'Datos Extraídos' : tab === 'raw' ? 'Texto OCR' : 'Historial / Auditoría'}
              </button>
            ))}
          </div>
          
          <div className="p-6 overflow-y-auto">
            {activeTab === 'extracted' && (
              <div className="space-y-4">
                {/* CAMPO: BENEFICIARIO */}
                <div>
                  <p className="text-xs text-apple-textSecondary uppercase tracking-wider">Beneficiario / Emisor</p>
                  {isEditing ? (
                    <input 
                      type="text" 
                      value={editedData.beneficiario} 
                      onChange={(e) => setEditedData({...editedData, beneficiario: e.target.value})}
                      className="w-full mt-1 p-3 bg-apple-bg border border-apple-accent rounded-md focus:outline-none focus:ring-1 focus:ring-apple-accent transition-apple text-white font-medium"
                    />
                  ) : (
                    <div className="p-3 bg-apple-bgSecondary rounded-md border border-apple-border mt-1 font-medium">{editedData.beneficiario}</div>
                  )}
                </div>

                {/* CAMPO: MONTO */}
                <div>
                  <p className="text-xs text-apple-textSecondary uppercase tracking-wider">Monto Extraído (Q)</p>
                  {isEditing ? (
                    <input 
                      type="number" 
                      step="0.01"
                      value={editedData.monto} 
                      onChange={(e) => setEditedData({...editedData, monto: e.target.value})}
                      className="w-full mt-1 p-3 bg-apple-bg border border-apple-accent rounded-md focus:outline-none focus:ring-1 focus:ring-apple-accent transition-apple text-apple-accent font-medium"
                    />
                  ) : (
                    <div className="p-3 bg-apple-bgSecondary rounded-md border border-apple-border mt-1 font-medium text-apple-accent">
                      Q {parseFloat(editedData.monto || 0).toFixed(2)}
                    </div>
                  )}
                </div>

                {/* CAMPO: FECHA */}
                <div>
                  <p className="text-xs text-apple-textSecondary uppercase tracking-wider">Fecha de Documento</p>
                  {isEditing ? (
                    <input 
                      type="text" 
                      value={editedData.fecha_documento} 
                      onChange={(e) => setEditedData({...editedData, fecha_documento: e.target.value})}
                      className="w-full mt-1 p-3 bg-apple-bg border border-apple-accent rounded-md focus:outline-none focus:ring-1 focus:ring-apple-accent transition-apple text-white font-medium"
                    />
                  ) : (
                    <div className="p-3 bg-apple-bgSecondary rounded-md border border-apple-border mt-1 font-medium">{editedData.fecha_documento}</div>
                  )}
                </div>
              </div>
            )}
            
            {activeTab === 'audit' && (
              <div className="space-y-6">
                {auditTrail.map((item, idx) => (
                  <div key={item.id} className="flex gap-4 relative">
                    {idx !== auditTrail.length - 1 && <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-apple-border/50"></div>}
                    <div className="w-8 h-8 rounded-full bg-apple-bgSecondary border border-apple-border flex items-center justify-center text-apple-textSecondary z-10">
                      <item.icon size={14} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{item.event}</p>
                      <p className="text-xs text-apple-accent mt-0.5">Responsable: {item.actor}</p>
                      <p className="text-[10px] text-apple-textSecondary/60 mt-1 tabular-nums">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'raw' && (
              <div>
                 <p className="text-xs text-apple-textSecondary uppercase tracking-wider mb-2">Lectura Directa del Motor OCR</p>
                 <div className="p-4 bg-apple-bgSecondary/50 border border-apple-border rounded-lg text-apple-textSecondary text-sm font-mono whitespace-pre-wrap leading-relaxed">
                   {doc.raw_ocr || 'No se detectó texto en la imagen.'}
                 </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}