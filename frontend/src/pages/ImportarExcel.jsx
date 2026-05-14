import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, ArrowRight, ArrowLeft, Eye, History, AlertTriangle, Unlink } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { excelAPI } from '../services/api';
import { useApp } from '../context/AppContext';

const CAMPOS_SISTEMA = [
  { campo: 'fecha_emision',        label: 'Fecha de Emisión',         req: false },
  { campo: 'numero_autorizacion',  label: 'No. Autorización (UUID)',   req: true  },
  { campo: 'tipo_dte',             label: 'Tipo DTE',                  req: false },
  { campo: 'serie',                label: 'Serie',                     req: false },
  { campo: 'numero_dte',           label: 'Número DTE',                req: false },
  { campo: 'nit_emisor',           label: 'NIT Emisor',                req: false },
  { campo: 'nombre_emisor',        label: 'Nombre Emisor',             req: false },
  { campo: 'nombre_establecimiento',label: 'Establecimiento',           req: false },
  { campo: 'id_receptor',          label: 'ID/NIT Receptor',           req: false },
  { campo: 'nombre_receptor',      label: 'Nombre Receptor',           req: false },
  { campo: 'estado',               label: 'Estado (Vigente/Anulado)',  req: false },
  { campo: 'moneda',               label: 'Moneda',                    req: false },
  { campo: 'monto_total',          label: 'Gran Total (Monto)',        req: true  },
  { campo: 'monto_iva',            label: 'IVA',                       req: false },
  { campo: 'marca_anulado',        label: 'Marca Anulado',             req: false },
  { campo: 'fecha_anulacion',      label: 'Fecha Anulación',           req: false },
];

const PASOS = ['Subir archivo', 'Revisar mapeo', 'Confirmar'];

export function ImportarExcel() {
  const { user, showNotification } = useApp();
  const fileRef = useRef(null);

  const [paso,        setPaso]        = useState(0);
  const [archivo,     setArchivo]     = useState(null);
  const [analisis,    setAnalisis]    = useState(null);
  const [mapeo,       setMapeo]       = useState({});
  const [tipodoc,     setTipodoc]     = useState('compra');
  const [analizando,  setAnalizando]  = useState(false);
  const [importando,  setImportando]  = useState(false);
  const [resultado,   setResultado]   = useState(null);
  const [erroresDetalle, setErroresDetalle] = useState([]);
  const [anulaciones, setAnulaciones] = useState([]);
  const [anulacionesModalOpen, setAnulacionesModalOpen] = useState(false);
  const [historial,   setHistorial]   = useState([]);
  const [verHistorial,setVerHistorial]= useState(false);
  const [drag,        setDrag]        = useState(false);

  useEffect(() => {
    excelAPI.historial().then(r => setHistorial(r.data || [])).catch(() => {});
  }, []);

  const procesarArchivo = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xls', 'xlsx', 'xlsm'].includes(ext)) {
      showNotification('Solo se permiten archivos Excel (.xls, .xlsx)', 'error'); return;
    }
    setArchivo(file);
    setAnalizando(true);
    try {
      const res = await excelAPI.analizar(file);
      setAnalisis(res);
      setMapeo(res.mappingSugerido || {});
      setPaso(1);
    } catch (e) {
      showNotification(e.message, 'error');
      setArchivo(null);
    } finally {
      setAnalizando(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDrag(false);
    const file = e.dataTransfer.files[0];
    if (file) procesarArchivo(file);
  };

  const handleConfirmar = async () => {
    const faltantes = CAMPOS_SISTEMA.filter(c => c.req && mapeo[c.campo] === undefined);
    if (faltantes.length > 0) {
      showNotification(`Campos requeridos sin mapear: ${faltantes.map(f => f.label).join(', ')}`, 'error'); return;
    }
    setImportando(true);
    setErroresDetalle([]);
    try {
      const res = await excelAPI.confirmar(archivo, mapeo, tipodoc, user?.email || 'sistema');
      setResultado(res.resumen);
      setErroresDetalle(res.errores || []);
      const anulConRel = res.facturas_anuladas_con_relaciones || [];
      setAnulaciones(anulConRel);
      setPaso(2);
      // Auto-abrir modal de anulaciones si hubo facturas anuladas con conciliaciones
      if (anulConRel.length > 0) setAnulacionesModalOpen(true);
      excelAPI.historial().then(r => setHistorial(r.data || [])).catch(() => {});
    } catch (e) {
      // Fetch error body for row-level details when available
      showNotification(e.message || 'Error al importar', 'error');
    } finally {
      setImportando(false);
    }
  };

  const reiniciar = () => {
    setPaso(0); setArchivo(null); setAnalisis(null);
    setMapeo({}); setResultado(null);
    setAnulaciones([]); setErroresDetalle([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const fmtQ = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;

  const select = 'bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text w-full appearance-none cursor-pointer';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-apple-text">Importar Excel SAT</h1>
          <p className="text-sm text-apple-textSecondary mt-0.5">Importa el reporte DTE-FEL de la Agencia Virtual del SAT</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setVerHistorial(v => !v)} className="gap-1.5 text-apple-textSecondary">
          <History size={14} /> {verHistorial ? 'Ocultar' : 'Historial'}
        </Button>
      </div>

      {/* Historial */}
      {verHistorial && (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-apple-border">
            <p className="text-sm font-medium text-apple-text">Importaciones anteriores</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-apple-textSecondary border-b border-apple-border bg-apple-bgSecondary/40">
                  {['Archivo', 'Fecha', 'Total', 'Importadas', 'Duplicadas', 'Errores', 'Estado'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-apple-border/40">
                {historial.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-apple-textSecondary">Sin importaciones anteriores</td></tr>
                ) : historial.map(h => (
                  <tr key={h.id} className="hover:bg-apple-bgSecondary/40">
                    <td className="px-4 py-2.5 max-w-[200px] truncate text-apple-text">{h.nombre_archivo}</td>
                    <td className="px-4 py-2.5 text-apple-textSecondary tabular-nums">{new Date(h.created_at).toLocaleDateString('es-GT')}</td>
                    <td className="px-4 py-2.5 tabular-nums">{h.total_filas}</td>
                    <td className="px-4 py-2.5 tabular-nums text-apple-success">{h.filas_importadas}</td>
                    <td className="px-4 py-2.5 tabular-nums text-apple-textSecondary">{h.filas_duplicadas}</td>
                    <td className="px-4 py-2.5 tabular-nums text-apple-error">{h.filas_error}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-1.5 py-0.5 rounded-full text-xs ${h.estado_importacion === 'completada' ? 'bg-apple-success/10 text-apple-success' : 'bg-apple-warning/10 text-apple-warning'}`}>
                        {h.estado_importacion}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-0">
        {PASOS.map((label, i) => (
          <React.Fragment key={i}>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                i < paso ? 'bg-apple-success text-black' : i === paso ? 'bg-apple-accent text-white' : 'bg-apple-bgSecondary text-apple-textSecondary border border-apple-border'
              }`}>
                {i < paso ? <CheckCircle2 size={14} /> : i + 1}
              </div>
              <span className={`text-sm ${i === paso ? 'text-apple-text font-medium' : 'text-apple-textSecondary'}`}>{label}</span>
            </div>
            {i < PASOS.length - 1 && <div className="flex-1 h-px bg-apple-border mx-3" />}
          </React.Fragment>
        ))}
      </div>

      {/* PASO 0: Subir archivo */}
      {paso === 0 && (
        <Card>
          <div
            className={`border-2 border-dashed rounded-apple p-12 text-center transition-apple cursor-pointer ${drag ? 'border-apple-accent bg-apple-accent/5' : 'border-apple-border hover:border-apple-accent/40'}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".xls,.xlsx,.xlsm" className="hidden"
              onChange={e => procesarArchivo(e.target.files[0])} />
            {analizando ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw size={32} className="animate-spin text-apple-accent" />
                <p className="text-sm text-apple-textSecondary">Analizando estructura del Excel...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <FileSpreadsheet size={40} className="text-apple-textSecondary" />
                <div>
                  <p className="text-base font-medium text-apple-text">Arrastra el Excel del SAT aquí</p>
                  <p className="text-sm text-apple-textSecondary mt-1">o haz clic para seleccionarlo — .xls, .xlsx</p>
                </div>
                <p className="text-xs text-apple-textSecondary">El sistema detecta automáticamente las columnas (InformacionDTE-FEL)</p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* PASO 1: Revisar/corregir mapeo */}
      {paso === 1 && analisis && (
        <div className="space-y-4">
          {/* Info del archivo */}
          <Card className="flex flex-wrap gap-6 items-center p-5">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={24} className="text-apple-success" />
              <div>
                <p className="text-sm font-medium text-apple-text">{archivo?.name}</p>
                <p className="text-xs text-apple-textSecondary">{analisis.totalFilas} filas · Sheet: {analisis.sheetName}</p>
              </div>
            </div>
            <div>
              <label className="text-xs text-apple-textSecondary block mb-1">Tipo de documento</label>
              <select className="bg-apple-bg border border-apple-border rounded-lg px-3 py-1.5 text-sm text-apple-text" value={tipodoc} onChange={e => setTipodoc(e.target.value)}>
                <option value="compra">Compra</option>
                <option value="venta">Venta</option>
              </select>
            </div>
          </Card>

          {/* Mapeo de columnas */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium text-apple-text">Mapeo de Columnas</p>
                <p className="text-xs text-apple-textSecondary mt-0.5">Verifica que cada campo del sistema corresponda a la columna correcta del Excel. Los campos <span className="text-apple-error">*</span> son obligatorios.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {CAMPOS_SISTEMA.map(({ campo, label, req }) => {
                const colActual = mapeo[campo];
                const headerActual = colActual !== undefined ? analisis.headers[colActual] : null;
                const mapped = colActual !== undefined;
                return (
                  <div
                    key={campo}
                    className={`bg-apple-bg border rounded-apple p-3 space-y-2 transition-apple ${
                      mapped ? 'border-apple-success/30' : req ? 'border-apple-warning/40' : 'border-apple-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 min-h-[32px]">
                      <p className="text-xs font-medium text-apple-text leading-tight">
                        {label}
                        {req && <span className="text-apple-error ml-0.5">*</span>}
                      </p>
                      {mapped && (
                        <CheckCircle2 size={13} className="text-apple-success shrink-0 mt-0.5" />
                      )}
                    </div>
                    <select
                      className={select}
                      value={colActual !== undefined ? colActual : ''}
                      onChange={e => {
                        const val = e.target.value;
                        setMapeo(m => val === '' ? (({ [campo]: _, ...rest }) => rest)(m) : { ...m, [campo]: Number(val) });
                      }}
                      title={headerActual || 'Sin mapear'}
                    >
                      <option value="">— Sin mapear —</option>
                      {analisis.headers.map((h, i) => (
                        <option key={i} value={i}>{i}: {h}</option>
                      ))}
                    </select>
                    {headerActual && (
                      <p className="text-[11px] text-apple-textSecondary truncate" title={headerActual}>
                        Columna: <span className="text-apple-success">{headerActual}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Preview */}
          {analisis.preview?.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-apple-border">
                <Eye size={14} className="text-apple-textSecondary" />
                <p className="text-xs font-medium text-apple-textSecondary">Vista previa — primeras {analisis.preview.length} filas</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-apple-border bg-apple-bgSecondary/40">
                      {analisis.headers.map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium text-apple-textSecondary whitespace-nowrap max-w-[120px] truncate">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-apple-border/40">
                    {analisis.preview.map((row, ri) => (
                      <tr key={ri} className="hover:bg-apple-bgSecondary/40">
                        {analisis.headers.map((h, ci) => (
                          <td key={ci} className="px-3 py-2 text-apple-textSecondary whitespace-nowrap max-w-[120px] truncate">
                            {String(row[h] ?? '').slice(0, 25)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={reiniciar} className="gap-1.5"><ArrowLeft size={14} /> Volver</Button>
            <Button onClick={handleConfirmar} disabled={importando} className="gap-1.5">
              {importando ? <><RefreshCw size={14} className="animate-spin" />Importando...</> : <>Confirmar e Importar <ArrowRight size={14} /></>}
            </Button>
          </div>
        </div>
      )}

      {/* PASO 2: Resultado */}
      {paso === 2 && resultado && (
        <Card className="text-center space-y-6 py-8">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-apple-success/10 flex items-center justify-center">
              <CheckCircle2 size={36} className="text-apple-success" />
            </div>
          </div>
          <div>
            <p className="text-xl font-semibold text-apple-text">Importación completada</p>
            <p className="text-sm text-apple-textSecondary mt-1">{archivo?.name}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto">
            <ResultStat label="En archivo"  value={resultado.total_en_archivo} color="text-apple-text" />
            <ResultStat label="Insertadas"  value={resultado.insertados}       color="text-apple-success" />
            <ResultStat label="Duplicadas"  value={resultado.duplicados}       color="text-apple-textSecondary" />
            <ResultStat label="Anuladas"    value={resultado.facturas_anuladas || 0} color={(resultado.facturas_anuladas || 0) > 0 ? 'text-apple-warning' : 'text-apple-textSecondary'} />
          </div>

          {(resultado.conciliaciones_revertidas > 0 || resultado.errores_parseo + resultado.errores_db > 0) && (
            <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
              {resultado.conciliaciones_revertidas > 0 && (
                <ResultStat label="Conciliaciones revertidas" value={resultado.conciliaciones_revertidas} color="text-apple-warning" />
              )}
              {resultado.errores_parseo + resultado.errores_db > 0 && (
                <ResultStat label="Errores" value={resultado.errores_parseo + resultado.errores_db} color="text-apple-error" />
              )}
            </div>
          )}

          {/* Banner de anulaciones con relaciones */}
          {anulaciones.length > 0 && (
            <div className="max-w-2xl mx-auto bg-apple-warning/10 border border-apple-warning/30 rounded-apple p-4 text-left">
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className="text-apple-warning shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-apple-warning">
                    {anulaciones.length} factura{anulaciones.length > 1 ? 's' : ''} anulada{anulaciones.length > 1 ? 's' : ''} tenía{anulaciones.length > 1 ? 'n' : ''} pagos vinculados
                  </p>
                  <p className="text-xs text-apple-textSecondary mt-0.5">
                    Las conciliaciones fueron revertidas automáticamente y los métodos de pago liberados.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setAnulacionesModalOpen(true)} className="gap-1.5 text-apple-warning border-apple-warning/40">
                  Ver detalles
                </Button>
              </div>
            </div>
          )}

          {erroresDetalle.length > 0 && (
            <div className="text-left max-w-lg mx-auto space-y-1.5">
              <p className="text-xs font-medium text-apple-warning flex items-center gap-1.5">
                <AlertCircle size={13} /> Filas con error ({erroresDetalle.length}):
              </p>
              <div className="bg-apple-bgSecondary border border-apple-border rounded-apple p-3 max-h-36 overflow-y-auto space-y-1">
                {erroresDetalle.map((e, i) => (
                  <p key={i} className="text-xs text-apple-textSecondary">
                    <span className="text-apple-warning font-medium">Fila {e.fila}:</span> {e.error}
                  </p>
                ))}
              </div>
            </div>
          )}
          <Button onClick={reiniciar} className="mx-auto gap-1.5">
            <Upload size={14} /> Importar otro archivo
          </Button>
        </Card>
      )}

      {/* Modal: detalle de facturas anuladas con conciliaciones revertidas */}
      <Modal
        open={anulacionesModalOpen}
        onClose={() => setAnulacionesModalOpen(false)}
        title="Facturas Anuladas con Pagos Vinculados"
        width="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-apple-warning/10 border border-apple-warning/30 rounded-apple">
            <AlertTriangle size={18} className="text-apple-warning shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-apple-warning">
                Estas facturas cambiaron a "Anulada" en el Excel pero ya tenían pagos conciliados.
              </p>
              <p className="text-xs text-apple-textSecondary mt-1">
                Las conciliaciones se revirtieron automáticamente y el saldo de los métodos de pago fue restaurado.
              </p>
            </div>
          </div>

          <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
            {anulaciones.map((a) => (
              <div key={a.numero_autorizacion} className="bg-apple-bg border border-apple-border rounded-apple p-3">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-apple-textSecondary">UUID SAT</p>
                    <p className="font-mono text-xs text-apple-accent break-all">{a.numero_autorizacion}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 bg-apple-error/10 text-apple-error rounded font-medium shrink-0">
                    Anulada
                  </span>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs text-apple-textSecondary flex items-center gap-1.5">
                    <Unlink size={11} />
                    {a.conciliaciones.length} pago{a.conciliaciones.length > 1 ? 's' : ''} revertido{a.conciliaciones.length > 1 ? 's' : ''}:
                  </p>
                  <div className="space-y-1">
                    {a.conciliaciones.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-xs px-2 py-1.5 bg-apple-bgSecondary rounded">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="capitalize text-apple-text">{c.tipo_pago || '—'}</span>
                          {c.banco && <span className="text-apple-textSecondary truncate">· {c.banco}</span>}
                          {c.numero_documento && <span className="text-apple-textSecondary">· #{c.numero_documento}</span>}
                        </div>
                        <span className="tabular-nums font-medium text-apple-success shrink-0 ml-2">
                          {fmtQ(c.monto_aplicado)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs pt-1 border-t border-apple-border/40">
                    <span className="text-apple-textSecondary">Monto liberado:</span>
                    <span className="font-semibold tabular-nums text-apple-warning">{fmtQ(a.monto_pagado_previo)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setAnulacionesModalOpen(false)}>Entendido</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ResultStat({ label, value, color }) {
  return (
    <div className="bg-apple-bg border border-apple-border rounded-apple p-4">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-apple-textSecondary mt-1">{label}</p>
    </div>
  );
}
