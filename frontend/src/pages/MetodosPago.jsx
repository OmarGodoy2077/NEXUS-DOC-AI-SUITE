import React, { useState, useEffect, useCallback } from 'react';
import { Plus, RefreshCw, Download, CreditCard, Banknote, ArrowLeftRight, Coins, Ban, Eye, Trash2, ImageIcon, X, ExternalLink } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EstadoBadge } from '../components/finance/EstadoBadge';
import { pagosAPI } from '../services/api';
import { useApp } from '../context/AppContext';

const Q = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;

const TIPO_ICON  = { cheque: CreditCard, transferencia: ArrowLeftRight, deposito: Banknote, efectivo: Coins, anticipo: Coins, otro: Coins };
const TIPO_COLOR = { cheque: 'text-blue-400 bg-blue-400/10', transferencia: 'text-purple-400 bg-purple-400/10', deposito: 'text-green-400 bg-green-400/10', efectivo: 'text-yellow-400 bg-yellow-400/10', anticipo: 'text-orange-400 bg-orange-400/10', otro: 'text-apple-textSecondary bg-apple-bgSecondary' };

const TIPOS_PAGO = ['cheque', 'transferencia', 'deposito', 'efectivo', 'anticipo', 'otro'];

const EMPTY_FORM = { tipo: 'cheque', banco: '', numero_documento: '', fecha_documento: new Date().toISOString().split('T')[0], monto_inicial: '', descripcion: '', notas: '' };

export function MetodosPago() {
  const { user, showNotification } = useApp();
  const [pagos, setPagos]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [detalle, setDetalle]   = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);

  const [filterTipo, setFilterTipo]     = useState('');
  const [filterEstado, setFilterEstado] = useState('');
  const [comprobante, setComprobante]   = useState(null); // { url, tipo, banco, numero_documento }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterTipo)   params.tipo   = filterTipo;
      if (filterEstado) params.estado = filterEstado;
      const res = await pagosAPI.list({ ...params, limit: 200 });
      setPagos(res.data || []);
    } catch (e) {
      showNotification(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [filterTipo, filterEstado]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.monto_inicial || Number(form.monto_inicial) <= 0) {
      showNotification('El monto debe ser mayor a 0', 'error'); return;
    }
    setSaving(true);
    try {
      await pagosAPI.create({ ...form, monto_inicial: Number(form.monto_inicial), usuario_email: user.email });
      showNotification('Método de pago registrado correctamente');
      setShowForm(false);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      showNotification(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAnular = async (id) => {
    if (!confirm('¿Anular este método de pago? Solo es posible si no tiene conciliaciones.')) return;
    try {
      await pagosAPI.anular(id);
      showNotification('Anulado correctamente');
      load();
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  const handleEliminar = async (id) => {
    if (!confirm('¿Eliminar permanentemente este registro anulado? No se podrá recuperar.')) return;
    try {
      await pagosAPI.delete(id); // Necesitaremos asegurarnos de que la API soporte delete
      showNotification('Registro eliminado correctamente');
      load();
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  const handleVerDetalle = async (id) => {
    try {
      const data = await pagosAPI.get(id);
      setDetalle(data);
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  const exportCSV = () => {
    const rows = [['Tipo', 'Banco', 'No. Documento', 'Fecha', 'Monto Inicial', 'Saldo Disponible', 'Estado', 'Descripción']];
    pagos.forEach(p => rows.push([p.tipo, p.banco, p.numero_documento, p.fecha_documento, p.monto_inicial, p.saldo_disponible, p.estado, p.descripcion]));
    const csv = rows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `MetodosPago_NEXUS.csv`;
    a.click();
  };

  const select = 'bg-apple-bg border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text';
  const input  = `${select} w-full`;

  // Totales rápidos
  const totalDisponible = pagos.filter(p => p.estado !== 'anulado').reduce((s, p) => s + Number(p.saldo_disponible), 0);
  const totalInicial    = pagos.filter(p => p.estado !== 'anulado').reduce((s, p) => s + Number(p.monto_inicial), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-apple-text">Métodos de Pago</h1>
          <p className="text-sm text-apple-textSecondary mt-0.5">{pagos.length} registros · Saldo disponible: <span className="text-apple-success font-medium">{Q(totalDisponible)}</span></p>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportCSV} variant="outline" size="sm" className="gap-1.5"><Download size={14} /> CSV</Button>
          <Button onClick={() => { setShowForm(true); setForm(EMPTY_FORM); }} size="sm" className="gap-1.5">
            <Plus size={14} /> Registrar Pago
          </Button>
        </div>
      </div>

      {/* KPIs rápidos */}
      <div className="grid grid-cols-3 gap-3">
        <MiniKpi label="Total fondos" value={Q(totalInicial)} color="text-apple-text" />
        <MiniKpi label="Saldo disponible" value={Q(totalDisponible)} color="text-apple-success" />
        <MiniKpi label="Saldo utilizado" value={Q(totalInicial - totalDisponible)} color="text-apple-warning" />
      </div>

      {/* Filtros */}
      <Card className="p-4 flex flex-wrap gap-3 items-center">
        <select className={select} value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
          <option value="">Todos los tipos</option>
          {TIPOS_PAGO.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select className={select} value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {['disponible', 'utilizado_parcial', 'utilizado_total', 'anulado'].map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        {(filterTipo || filterEstado) && (
          <button className="text-xs text-apple-accent hover:underline" onClick={() => { setFilterTipo(''); setFilterEstado(''); }}>
            Limpiar
          </button>
        )}
      </Card>

      {/* Tabla */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-apple-textSecondary text-xs border-b border-apple-border bg-apple-bgSecondary/40">
                {['Tipo', 'Banco', 'Referencia', 'Fecha', 'Monto Inicial', 'Utilizado', 'Disponible', 'Estado', 'Descripción', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-border/40">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-apple-textSecondary text-sm">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />Cargando...
                </td></tr>
              ) : pagos.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-apple-textSecondary text-sm">
                  Sin métodos de pago. <button className="text-apple-accent hover:underline" onClick={() => setShowForm(true)}>Registrar el primero</button>
                </td></tr>
              ) : pagos.map(p => {
                const Icon = TIPO_ICON[p.tipo] ?? Coins;
                const iconCls = TIPO_COLOR[p.tipo] ?? TIPO_COLOR.otro;
                return (
                  <tr key={p.id} className="hover:bg-apple-bgSecondary/60 transition-apple">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`p-1.5 rounded-md ${iconCls}`}><Icon size={14} /></span>
                        <span className="capitalize text-apple-text">{p.tipo}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-apple-textSecondary truncate max-w-[120px]">
                      {p.banco ? <span className="font-medium text-apple-text" title={p.banco}>{p.banco}</span> : '—'}
                    </td>
                    <td className="px-4 py-3 text-apple-textSecondary truncate max-w-[100px]">
                      {p.numero_documento ? <span className="text-xs" title={p.numero_documento}>#{p.numero_documento}</span> : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-apple-textSecondary whitespace-nowrap">
                      {p.fecha_documento ? new Date(p.fecha_documento + 'T12:00:00').toLocaleDateString('es-GT') : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">{Q(p.monto_inicial)}</td>
                    <td className="px-4 py-3 tabular-nums text-apple-warning">{Q(p.saldo_utilizado)}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-apple-success">{Q(p.saldo_disponible)}</td>
                    <td className="px-4 py-3"><EstadoBadge estado={p.estado} /></td>
                    <td className="px-4 py-3 text-apple-textSecondary max-w-[160px] truncate text-xs">{p.descripcion || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {p.url_comprobante && (
                          <button
                            onClick={() => setComprobante({ url: p.url_comprobante, tipo: p.tipo, banco: p.banco, numero_documento: p.numero_documento })}
                            className="p-1.5 rounded hover:bg-apple-bgSecondary text-apple-textSecondary hover:text-apple-accent transition-apple"
                            title="Ver comprobante"
                          >
                            <ImageIcon size={14} />
                          </button>
                        )}
                        <button onClick={() => handleVerDetalle(p.id)} className="p-1.5 rounded hover:bg-apple-bgSecondary text-apple-textSecondary hover:text-apple-accent transition-apple" title="Ver facturas vinculadas">
                          <Eye size={14} />
                        </button>
                        {p.estado !== 'anulado' && (
                          <button onClick={() => handleAnular(p.id)} className="p-1.5 rounded hover:bg-apple-error/10 text-apple-textSecondary hover:text-apple-error transition-apple" title="Anular">
                            <Ban size={14} />
                          </button>
                        )}
                        {p.estado === 'anulado' && (
                          <button onClick={() => handleEliminar(p.id)} className="p-1.5 rounded hover:bg-red-500/10 text-apple-textSecondary hover:text-red-500 transition-apple" title="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal Nuevo Pago */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Registrar Método de Pago" width="max-w-lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-apple-textSecondary mb-1 block">Tipo *</label>
              <select className={input} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {TIPOS_PAGO.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-apple-textSecondary mb-1 block">Fecha del documento *</label>
              <input type="date" className={input} value={form.fecha_documento} onChange={e => setForm(f => ({ ...f, fecha_documento: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-apple-textSecondary mb-1 block">Banco</label>
              <input className={input} placeholder="Ej: BANRURAL, G&T" value={form.banco} onChange={e => setForm(f => ({ ...f, banco: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-apple-textSecondary mb-1 block">No. Cheque / Referencia</label>
              <input className={input} placeholder="Ej: CHQ-12345" value={form.numero_documento} onChange={e => setForm(f => ({ ...f, numero_documento: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs text-apple-textSecondary mb-1 block">Monto Inicial (Q) *</label>
            <input type="number" min="0.01" step="0.01" className={input} placeholder="0.00" value={form.monto_inicial} onChange={e => setForm(f => ({ ...f, monto_inicial: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-apple-textSecondary mb-1 block">Descripción / Beneficiario</label>
            <input className={input} placeholder="Ej: Pago a Proveedor XYZ" value={form.descripcion} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-apple-textSecondary mb-1 block">Notas internas</label>
            <textarea rows={2} className={`${input} resize-none`} placeholder="Observaciones..." value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <><RefreshCw size={14} className="animate-spin mr-1" />Guardando...</> : 'Registrar'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal Comprobante — imagen original del cheque/transferencia */}
      {comprobante && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setComprobante(null)}
        >
          <div
            className="bg-apple-bgSecondary border border-apple-border rounded-apple shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-apple-border shrink-0">
              <div>
                <p className="font-semibold text-apple-text capitalize">{comprobante.tipo} — Comprobante original</p>
                <p className="text-xs text-apple-textSecondary mt-0.5">
                  {comprobante.banco ? `${comprobante.banco}` : ''}
                  {comprobante.numero_documento ? ` · #${comprobante.numero_documento}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={comprobante.url}
                  download
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-apple-accent hover:underline px-2 py-1.5 rounded hover:bg-apple-bgSecondary transition-apple"
                  title="Descargar comprobante"
                >
                  <Download size={13} /> Descargar
                </a>
                <a
                  href={comprobante.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-apple-textSecondary hover:text-apple-text px-2 py-1.5 rounded hover:bg-apple-bgSecondary transition-apple"
                  title="Abrir en nueva pestaña"
                >
                  <ExternalLink size={13} />
                </a>
                <button
                  onClick={() => setComprobante(null)}
                  className="p-1.5 rounded hover:bg-apple-bgSecondary text-apple-textSecondary hover:text-apple-text transition-apple"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="overflow-auto flex-1 flex items-center justify-center p-4 bg-black/20">
              <img
                src={comprobante.url}
                alt="Comprobante"
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalle pago (facturas vinculadas) */}
      <Modal open={!!detalle} onClose={() => setDetalle(null)} title="Facturas Vinculadas" width="max-w-xl">
        {detalle && (
          <div className="space-y-4">
            <div className="bg-apple-bg border border-apple-border rounded-apple p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-apple-textSecondary">Tipo</span>
                <span className="capitalize font-medium">{detalle.pago?.tipo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-apple-textSecondary">Monto inicial</span>
                <span className="tabular-nums font-medium">{Q(detalle.pago?.monto_inicial)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-apple-textSecondary">Saldo disponible</span>
                <span className="tabular-nums font-semibold text-apple-success">{Q(detalle.pago?.saldo_disponible)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-apple-textSecondary">Estado</span>
                <EstadoBadge estado={detalle.pago?.estado} />
              </div>
            </div>
            <p className="text-sm font-medium text-apple-text">Facturas vinculadas ({detalle.conciliaciones?.length ?? 0})</p>
            {(detalle.conciliaciones ?? []).length === 0 ? (
              <p className="text-sm text-apple-textSecondary text-center py-4">Sin facturas vinculadas</p>
            ) : detalle.conciliaciones.map(c => (
              <div key={c.conciliacion_id} className="flex items-center justify-between bg-apple-bg border border-apple-border rounded-apple p-3 text-sm">
                <div>
                  <p className="font-mono text-xs text-apple-textSecondary">{c.numero_autorizacion?.slice(0, 12)}…</p>
                  <p className="text-apple-text">{c.nombre_emisor}</p>
                  <p className="text-xs text-apple-textSecondary">{c.fecha_conciliacion}</p>
                </div>
                <span className="tabular-nums font-semibold text-apple-success">{Q(c.monto_aplicado)}</span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

function MiniKpi({ label, value, color }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-apple-textSecondary mb-1">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </Card>
  );
}
