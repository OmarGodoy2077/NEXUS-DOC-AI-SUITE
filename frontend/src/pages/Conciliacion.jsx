import React, { useState, useEffect, useCallback } from 'react';
import { Link2, RefreshCw, CheckCircle2, AlertCircle, ArrowRight, Search, Trash2, Zap, Target } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EstadoBadge } from '../components/finance/EstadoBadge';
import { PeriodFilter, periodoToRange } from '../components/finance/PeriodFilter';
import { conciliacionesAPI, pagosAPI, facturasAPI } from '../services/api';
import { useApp } from '../context/AppContext';

const Q = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;

export function Conciliacion() {
  const { user, showNotification } = useApp();
  const curYear = new Date().getFullYear();

  // Filtros del período
  const [year, setYear]   = useState(String(curYear));
  const [month, setMonth] = useState('');
  const [busqueda, setBusqueda] = useState('');

  // Datos
  const [facturasPendientes, setFacturasPendientes] = useState([]);
  const [pagosDisponibles,   setPagosDisponibles]   = useState([]);
  const [historial,          setHistorial]          = useState([]);
  const [loadingFacturas,    setLoadingFacturas]    = useState(true);
  const [loadingPagos,       setLoadingPagos]       = useState(true);
  const [loadingHistorial,   setLoadingHistorial]   = useState(true);

  // Estado del formulario de vinculación
  const [facturaSeleccionada, setFacturaSeleccionada] = useState(null);
  const [pagoSeleccionado,    setPagoSeleccionado]    = useState(null);
  const [montoAplicar,        setMontoAplicar]        = useState('');
  const [notas,               setNotas]               = useState('');
  const [vinculando,          setVinculando]          = useState(false);
  const [confirmOpen,         setConfirmOpen]         = useState(false);

  const loadFacturas = useCallback(async () => {
    setLoadingFacturas(true);
    try {
      const { desde, hasta } = periodoToRange(year, month);
      const params = { desde, hasta, estados: 'pendiente,parcial', limit: 100, page: 1 };
      if (busqueda) params.busqueda = busqueda;
      const res = await facturasAPI.list(params);
      setFacturasPendientes(res.data || []);
    } finally {
      setLoadingFacturas(false);
    }
  }, [year, month, busqueda]);

  const loadPagos = useCallback(async () => {
    setLoadingPagos(true);
    try {
      const res = await pagosAPI.disponibles();
      setPagosDisponibles(res.data || []);
    } finally {
      setLoadingPagos(false);
    }
  }, []);

  const loadHistorial = useCallback(async () => {
    setLoadingHistorial(true);
    try {
      const { desde, hasta } = periodoToRange(year, month);
      const res = await conciliacionesAPI.reporte({ desde, hasta });
      setHistorial((res.data || []).filter(r => r.conciliacion_id).slice(0, 50));
    } finally {
      setLoadingHistorial(false);
    }
  }, [year, month]);

  useEffect(() => { loadFacturas(); }, [loadFacturas]);
  useEffect(() => { loadPagos(); }, [loadPagos]);
  useEffect(() => { loadHistorial(); }, [loadHistorial]);

  // Sugerir monto automáticamente al seleccionar ambos
  useEffect(() => {
    if (!facturaSeleccionada || !pagoSeleccionado) return;
    const max = Math.min(Number(facturaSeleccionada.saldo_pendiente), Number(pagoSeleccionado.saldo_disponible));
    setMontoAplicar(max.toFixed(2));
  }, [facturaSeleccionada, pagoSeleccionado]);

  const handleVincular = async () => {
    const monto = Number(montoAplicar);
    if (!facturaSeleccionada) { showNotification('Selecciona una factura', 'error'); return; }
    if (!pagoSeleccionado)    { showNotification('Selecciona un método de pago', 'error'); return; }
    if (!monto || monto <= 0) { showNotification('Ingresa un monto válido', 'error'); return; }
    setConfirmOpen(true);
  };

  const confirmarVinculacion = async () => {
    setVinculando(true);
    setConfirmOpen(false);
    try {
      await conciliacionesAPI.crear({
        factura_id:        facturaSeleccionada.id,
        metodo_pago_id:    pagoSeleccionado.id,
        monto_aplicado:    Number(montoAplicar),
        fecha_conciliacion: new Date().toISOString().split('T')[0],
        usuario_email:     user.email,
        notas,
      });
      showNotification('Conciliación registrada correctamente');
      setFacturaSeleccionada(null);
      setPagoSeleccionado(null);
      setMontoAplicar('');
      setNotas('');
      await Promise.all([loadFacturas(), loadPagos(), loadHistorial()]);
    } catch (e) {
      showNotification(e.message, 'error');
    } finally {
      setVinculando(false);
    }
  };

  const handleRevertir = async (conciliacion_id) => {
    if (!confirm('¿Revertir esta conciliación? Los saldos se actualizarán automáticamente.')) return;
    try {
      await conciliacionesAPI.revertir(conciliacion_id);
      showNotification('Conciliación revertida');
      await Promise.all([loadFacturas(), loadPagos(), loadHistorial()]);
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  const saldoFact  = facturaSeleccionada ? Number(facturaSeleccionada.saldo_pendiente)  : 0;
  const saldoPago  = pagoSeleccionado    ? Number(pagoSeleccionado.saldo_disponible)     : 0;
  const maxMonto   = Math.min(saldoFact, saldoPago);
  const montoNum   = Number(montoAplicar) || 0;
  const montoValido = montoNum > 0 && montoNum <= maxMonto;

  const select = 'bg-apple-bg border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-apple-text">Conciliación de Pagos</h1>
          <p className="text-sm text-apple-textSecondary mt-0.5">Vincula facturas pendientes con fondos disponibles</p>
        </div>
        <PeriodFilter year={year} month={month} onYearChange={setYear} onMonthChange={setMonth} />
      </div>

      {/* Workspace de conciliación — 3 columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Col 1: Facturas pendientes */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-apple-text">Facturas Pendientes / Parciales</p>
            <span className="text-xs text-apple-textSecondary bg-apple-bgSecondary px-2 py-0.5 rounded-full">{facturasPendientes.length}</span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-apple-textSecondary" />
            <input className={`${select} w-full pl-8`} placeholder="Buscar..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
          </div>
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {loadingFacturas ? <Spinner /> : facturasPendientes.length === 0 ? (
              <EmptyState msg="Sin facturas pendientes en el período" />
            ) : facturasPendientes.map(f => (
              <SelectableCard
                key={f.id}
                selected={facturaSeleccionada?.id === f.id}
                onClick={() => setFacturaSeleccionada(f)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-apple-text truncate">{f.nombre_emisor || '—'}</p>
                    <p className="text-xs text-apple-textSecondary truncate">{f.nombre_receptor || '—'}</p>
                    <p className="text-xs text-apple-textSecondary mt-0.5">
                      {f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-GT') : '—'}
                    </p>
                  </div>
                  <EstadoBadge estado={f.estado} />
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-apple-textSecondary">Pendiente:</span>
                  <span className="font-semibold tabular-nums text-apple-warning">{Q(f.saldo_pendiente)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-apple-textSecondary">Total:</span>
                  <span className="tabular-nums">{Q(f.monto_total)}</span>
                </div>
              </SelectableCard>
            ))}
          </div>
        </div>

        {/* Col 2: Panel central de vinculación */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-apple-text text-center">Vincular</p>

          <Card className={`p-4 border-2 transition-apple ${facturaSeleccionada ? 'border-apple-accent/40 bg-apple-accent/5' : 'border-dashed border-apple-border'}`}>
            <p className="text-xs text-apple-textSecondary mb-2">Factura seleccionada</p>
            {facturaSeleccionada ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-apple-text truncate">{facturaSeleccionada.nombre_emisor}</p>
                <p className="text-xs text-apple-textSecondary">Pendiente: <span className="text-apple-warning font-semibold">{Q(facturaSeleccionada.saldo_pendiente)}</span></p>
              </div>
            ) : <p className="text-xs text-apple-textSecondary italic">← Selecciona una factura</p>}
          </Card>

          <div className="flex justify-center"><ArrowRight size={18} className="text-apple-textSecondary rotate-90 lg:rotate-0" /></div>

          <Card className={`p-4 border-2 transition-apple ${pagoSeleccionado ? 'border-apple-success/40 bg-apple-success/5' : 'border-dashed border-apple-border'}`}>
            <p className="text-xs text-apple-textSecondary mb-2">Método de pago seleccionado</p>
            {pagoSeleccionado ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-apple-text capitalize">{pagoSeleccionado.tipo} {pagoSeleccionado.banco ? `— ${pagoSeleccionado.banco}` : ''}</p>
                {pagoSeleccionado.numero_documento && <p className="text-xs text-apple-textSecondary">#{pagoSeleccionado.numero_documento}</p>}
                <p className="text-xs text-apple-textSecondary">Disponible: <span className="text-apple-success font-semibold">{Q(pagoSeleccionado.saldo_disponible)}</span></p>
              </div>
            ) : <p className="text-xs text-apple-textSecondary italic">→ Selecciona un pago</p>}
          </Card>

          {facturaSeleccionada && pagoSeleccionado && (
            <div className="space-y-3 bg-apple-bgSecondary rounded-apple p-4 border border-apple-border">
              {/* Quick-apply buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMontoAplicar(Math.min(saldoPago, saldoFact).toFixed(2))}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-apple-accent/40 bg-apple-accent/5 hover:bg-apple-accent/10 text-apple-accent text-xs font-medium transition-apple"
                  title="Usar todo el saldo disponible del pago (hasta cubrir la factura)"
                >
                  <Zap size={12} /> Todo el pago
                </button>
                <button
                  onClick={() => saldoPago >= saldoFact && setMontoAplicar(saldoFact.toFixed(2))}
                  disabled={saldoPago < saldoFact}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-apple-success/40 bg-apple-success/5 hover:bg-apple-success/10 text-apple-success text-xs font-medium transition-apple disabled:opacity-40 disabled:cursor-not-allowed"
                  title={saldoPago < saldoFact ? `Pago insuficiente — faltan ${Q(saldoFact - saldoPago)}` : 'Cubrir el total pendiente de la factura'}
                >
                  <Target size={12} /> Cubrir factura
                </button>
              </div>

              <div>
                <label className="text-xs text-apple-textSecondary block mb-1">
                  Monto a aplicar (Q) — máx. {Q(maxMonto)}
                </label>
                <input
                  type="number" min="0.01" step="0.01" max={maxMonto}
                  className="w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text"
                  value={montoAplicar}
                  onChange={e => setMontoAplicar(e.target.value)}
                />
                {montoAplicar && !montoValido && (
                  <p className="text-xs text-apple-error mt-1">
                    {montoNum > maxMonto ? `Excede el máximo (${Q(maxMonto)})` : 'Monto inválido'}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-apple-textSecondary block mb-1">Notas (opcional)</label>
                <input className="w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text"
                  placeholder="Observaciones..." value={notas} onChange={e => setNotas(e.target.value)} />
              </div>
              <Button
                className="w-full gap-2"
                onClick={handleVincular}
                disabled={!montoValido || vinculando}
              >
                {vinculando
                  ? <><RefreshCw size={14} className="animate-spin" /> Vinculando...</>
                  : <><Link2 size={14} /> Registrar Conciliación</>}
              </Button>
            </div>
          )}

          {!facturaSeleccionada || !pagoSeleccionado ? (
            <p className="text-xs text-apple-textSecondary text-center">Selecciona una factura y un pago para continuar</p>
          ) : null}
        </div>

        {/* Col 3: Pagos disponibles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-apple-text">Fondos Disponibles</p>
            <span className="text-xs text-apple-textSecondary bg-apple-bgSecondary px-2 py-0.5 rounded-full">{pagosDisponibles.length}</span>
          </div>
          <div className="space-y-2 max-h-[528px] overflow-y-auto pr-1">
            {loadingPagos ? <Spinner /> : pagosDisponibles.length === 0 ? (
              <EmptyState msg="Sin fondos disponibles. Registra un cheque o transferencia." />
            ) : pagosDisponibles.map(p => (
              <SelectableCard
                key={p.id}
                selected={pagoSeleccionado?.id === p.id}
                onClick={() => setPagoSeleccionado(p)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-apple-text capitalize">{p.tipo}</p>
                    {p.banco && <p className="text-xs text-apple-textSecondary">{p.banco}</p>}
                    {p.numero_documento && <p className="text-xs text-apple-textSecondary">#{p.numero_documento}</p>}
                    {!p.banco && !p.numero_documento && p.descripcion && (
                      <p className="text-xs text-apple-textSecondary truncate">{p.descripcion}</p>
                    )}
                    <p className="text-xs text-apple-textSecondary">{p.fecha_documento ? new Date(p.fecha_documento + 'T12:00:00').toLocaleDateString('es-GT') : '—'}</p>
                  </div>
                  <EstadoBadge estado={p.estado} />
                </div>
                <div className="flex justify-between mt-2 text-xs">
                  <span className="text-apple-textSecondary">Disponible:</span>
                  <span className="font-semibold tabular-nums text-apple-success">{Q(p.saldo_disponible)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-apple-textSecondary">Original:</span>
                  <span className="tabular-nums">{Q(p.monto_inicial)}</span>
                </div>
              </SelectableCard>
            ))}
          </div>
        </div>
      </div>

      {/* Historial de conciliaciones del período */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-apple-border">
          <p className="text-sm font-medium text-apple-text">Historial de Conciliaciones</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-apple-textSecondary text-xs border-b border-apple-border bg-apple-bgSecondary/40">
                {['Factura (Emisor)', 'Tipo Pago', 'Banco / Ref.', 'Fecha', 'Monto Aplicado', 'Pendiente Restante', 'Usuario', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-border/40">
              {loadingHistorial ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-apple-textSecondary text-sm"><RefreshCw size={14} className="animate-spin inline mr-1" />Cargando...</td></tr>
              ) : historial.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-apple-textSecondary text-sm">Sin conciliaciones en el período seleccionado</td></tr>
              ) : historial.map(c => (
                <tr key={c.conciliacion_id} className="hover:bg-apple-bgSecondary/50 transition-apple">
                  <td className="px-4 py-3 max-w-[160px] truncate text-apple-text">{c.nombre_emisor || '—'}</td>
                  <td className="px-4 py-3 capitalize text-apple-textSecondary">{c.tipo_pago || '—'}</td>
                  <td className="px-4 py-3 text-apple-textSecondary text-xs">
                    {c.banco || ''} {c.numero_cheque_o_referencia ? `#${c.numero_cheque_o_referencia}` : ''}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-apple-textSecondary whitespace-nowrap">
                    {c.fecha_conciliacion ? new Date(c.fecha_conciliacion + 'T12:00:00').toLocaleDateString('es-GT') : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-semibold text-apple-success whitespace-nowrap">{Q(c.monto_aplicado)}</td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                    <span className={Number(c.saldo_pendiente) > 0 ? 'text-apple-warning' : 'text-apple-success'}>
                      {Q(c.saldo_pendiente)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-apple-textSecondary text-xs">{c.usuario_conciliacion}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRevertir(c.conciliacion_id)}
                      className="p-1.5 rounded hover:bg-apple-error/10 text-apple-textSecondary hover:text-apple-error transition-apple"
                      title="Revertir conciliación"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal de confirmación */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirmar Conciliación" width="max-w-md">
        <div className="space-y-4">
          <div className="bg-apple-bg border border-apple-border rounded-apple p-4 space-y-3 text-sm">
            <Row label="Factura" value={facturaSeleccionada?.nombre_emisor} />
            <Row label="Saldo pendiente factura" value={Q(facturaSeleccionada?.saldo_pendiente)} />
            <Row label="Método de pago" value={`${pagoSeleccionado?.tipo} ${pagoSeleccionado?.banco || ''}`} />
            <Row label="Saldo disponible pago" value={Q(pagoSeleccionado?.saldo_disponible)} />
            <hr className="border-apple-border" />
            <Row label="Monto a aplicar" value={Q(montoAplicar)} bold />
            {notas && <Row label="Notas" value={notas} />}
          </div>
          <p className="text-xs text-apple-textSecondary">
            Los saldos de la factura y el método de pago se actualizarán automáticamente.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={confirmarVinculacion} className="gap-1.5">
              <CheckCircle2 size={14} /> Confirmar
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SelectableCard({ selected, onClick, children }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-apple border p-3 cursor-pointer transition-apple ${
        selected
          ? 'border-apple-accent bg-apple-accent/10 shadow-[0_0_0_1px_#2997FF]'
          : 'border-apple-border bg-apple-bgSecondary hover:border-apple-accent/30 hover:bg-apple-bgSecondary/80'
      }`}
    >
      {children}
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-8 text-apple-textSecondary text-sm"><RefreshCw size={16} className="animate-spin mr-2" />Cargando...</div>;
}

function EmptyState({ msg }) {
  return <div className="text-center py-8 text-apple-textSecondary text-xs border border-dashed border-apple-border rounded-apple">{msg}</div>;
}

function Row({ label, value, bold }) {
  return (
    <div className="flex justify-between">
      <span className="text-apple-textSecondary">{label}</span>
      <span className={bold ? 'font-semibold text-apple-text' : 'text-apple-text'}>{value}</span>
    </div>
  );
}
