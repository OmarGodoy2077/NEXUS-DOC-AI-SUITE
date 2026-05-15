import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Link2, RefreshCw, CheckCircle2, ArrowRight, Search, Trash2,
  Zap, Target, Filter, ChevronDown, ChevronUp, History, X,
  SortAsc, SortDesc, SquareCheck, Square, FileMinus, Banknote, Loader2,
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EstadoBadge } from '../components/finance/EstadoBadge';
import { PeriodFilter, periodoToRange } from '../components/finance/PeriodFilter';
import { conciliacionesAPI, pagosAPI, facturasAPI } from '../services/api';
import { useApp } from '../context/AppContext';

const Q = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
const fmt = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-GT') : '—';

const SORT_OPTIONS = [
  { key: 'fecha_emision_desc', label: 'Fecha ↓' },
  { key: 'fecha_emision_asc',  label: 'Fecha ↑' },
  { key: 'saldo_desc',         label: 'Pendiente ↓' },
  { key: 'saldo_asc',         label: 'Pendiente ↑' },
  { key: 'emisor_asc',         label: 'Emisor A–Z' },
];

export function Conciliacion() {
  const { user, showNotification } = useApp();
  const curYear = new Date().getFullYear();

  // ── Período ──────────────────────────────────────────────────
  const [year, setYear]   = useState(String(curYear));
  const [month, setMonth] = useState('');

  // ── Filtros facturas ─────────────────────────────────────────
  const [busqueda,    setBusqueda]    = useState('');
  const [filtroEmisores, setFiltroEmisores] = useState('');  // texto libre
  const [filtroEstado,   setFiltroEstado]   = useState('');  // pendiente | parcial | ''
  const [sortKey,        setSortKey]        = useState('fecha_emision_desc');
  const [filtrosOpen,    setFiltrosOpen]    = useState(false);

  // ── Datos ─────────────────────────────────────────────────────
  const [facturasPendientes, setFacturasPendientes] = useState([]);
  const [pagosDisponibles,   setPagosDisponibles]   = useState([]);
  const [historial,          setHistorial]          = useState([]);
  const [loadingFacturas,    setLoadingFacturas]    = useState(true);
  const [loadingPagos,       setLoadingPagos]       = useState(true);
  const [loadingHistorial,   setLoadingHistorial]   = useState(false);
  const [historialOpen,      setHistorialOpen]      = useState(false);

  // ── Selección múltiple de facturas ───────────────────────────
  const [seleccionadas,   setSeleccionadas]   = useState(new Set());   // Set<id>
  const [pagoSeleccionado, setPagoSeleccionado] = useState(null);
  const [montoAplicar,   setMontoAplicar]     = useState('');
  const [notas,          setNotas]            = useState('');
  const [vinculando,     setVinculando]       = useState(false);
  const [confirmOpen,    setConfirmOpen]      = useState(false);

  // ── Notas de crédito disponibles para los emisores seleccionados ──
  const [ncreDisponibles,   setNcreDisponibles]  = useState([]);
  const [ncreLoading,       setNcreLoading]      = useState(false);
  const [ncreAplicaciones,  setNcreAplicaciones] = useState({}); // { nc_id: { factura_id, monto } }

  // ── Pago en efectivo ─────────────────────────────────────────
  const [efectivoOpen,     setEfectivoOpen]     = useState(false);
  const [efectivoMonto,    setEfectivoMonto]    = useState('');
  const [efectivoNotas,    setEfectivoNotas]    = useState('');
  const [efectivoLoading,  setEfectivoLoading]  = useState(false);

  // ── Carga de datos ────────────────────────────────────────────
  const loadFacturas = useCallback(async () => {
    setLoadingFacturas(true);
    try {
      const { desde, hasta } = periodoToRange(year, month);
      const params = { desde, hasta, estados: 'pendiente,parcial', limit: 200, page: 1 };
      if (busqueda) params.busqueda = busqueda;
      const res = await facturasAPI.list(params);
      setFacturasPendientes(res.data || []);
      // Limpiar selección al recargar
      setSeleccionadas(new Set());
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
      setHistorial((res.data || []).filter(r => r.conciliacion_id));
    } finally {
      setLoadingHistorial(false);
    }
  }, [year, month]);

  useEffect(() => { loadFacturas(); }, [loadFacturas]);
  useEffect(() => { loadPagos(); }, [loadPagos]);

  // Cargar historial solo cuando el panel está abierto
  useEffect(() => {
    if (historialOpen) loadHistorial();
  }, [historialOpen, loadHistorial]);

  // ── Filtrado + ordenamiento local (sin hit extra al servidor) ─
  const facturasFiltradas = useMemo(() => {
    let lista = [...facturasPendientes];

    if (filtroEmisores.trim()) {
      const term = filtroEmisores.toLowerCase();
      lista = lista.filter(f =>
        (f.nombre_emisor || '').toLowerCase().includes(term) ||
        (f.nit_emisor    || '').toLowerCase().includes(term)
      );
    }

    if (filtroEstado) {
      lista = lista.filter(f => f.estado === filtroEstado);
    }

    // Ordenamiento
    lista.sort((a, b) => {
      switch (sortKey) {
        case 'fecha_emision_asc':  return new Date(a.fecha_emision) - new Date(b.fecha_emision);
        case 'fecha_emision_desc': return new Date(b.fecha_emision) - new Date(a.fecha_emision);
        case 'saldo_desc':         return Number(b.saldo_pendiente) - Number(a.saldo_pendiente);
        case 'saldo_asc':          return Number(a.saldo_pendiente) - Number(b.saldo_pendiente);
        case 'emisor_asc':         return (a.nombre_emisor || '').localeCompare(b.nombre_emisor || '');
        default:                   return 0;
      }
    });

    return lista;
  }, [facturasPendientes, filtroEmisores, filtroEstado, sortKey]);

  // ── Emisores únicos para el filtro de autocomplete ───────────
  const emisoresUnicos = useMemo(() => {
    const set = new Set(facturasPendientes.map(f => f.nombre_emisor).filter(Boolean));
    return [...set].sort();
  }, [facturasPendientes]);

  // ── Totales de selección ─────────────────────────────────────
  const facturasSeleccionadas = useMemo(
    () => facturasFiltradas.filter(f => seleccionadas.has(f.id)),
    [facturasFiltradas, seleccionadas]
  );

  const totalPendienteSeleccion = useMemo(
    () => facturasSeleccionadas.reduce((acc, f) => acc + Number(f.saldo_pendiente || 0), 0),
    [facturasSeleccionadas]
  );

  const saldoPago  = pagoSeleccionado ? Number(pagoSeleccionado.saldo_disponible) : 0;

  // ── Cargar NCRE disponibles para los emisores seleccionados ──
  const nitsEmisoresSel = useMemo(() => {
    const nits = new Set(facturasSeleccionadas.map(f => f.nit_emisor).filter(Boolean));
    return [...nits];
  }, [facturasSeleccionadas]);

  useEffect(() => {
    if (nitsEmisoresSel.length === 0) {
      setNcreDisponibles([]);
      setNcreAplicaciones({});
      return;
    }
    setNcreLoading(true);
    facturasAPI.notasCreditoDisponibles(nitsEmisoresSel)
      .then(res => setNcreDisponibles(res.data || []))
      .catch(() => setNcreDisponibles([]))
      .finally(() => setNcreLoading(false));
  }, [nitsEmisoresSel.join(',')]);

  // Limpiar aplicaciones cuya factura ya no esté seleccionada o cuya NCRE ya no esté disponible
  useEffect(() => {
    const ncreIds = new Set(ncreDisponibles.map(n => n.id));
    setNcreAplicaciones(prev => {
      const next = {};
      Object.entries(prev).forEach(([ncId, ap]) => {
        if (ncreIds.has(ncId) && seleccionadas.has(ap.factura_id)) {
          next[ncId] = ap;
        }
      });
      return next;
    });
  }, [seleccionadas, ncreDisponibles]);

  // Total de NCRE aplicadas en esta sesión
  const totalNcreAplicado = useMemo(
    () => Object.values(ncreAplicaciones).reduce((acc, ap) => acc + Number(ap.monto || 0), 0),
    [ncreAplicaciones]
  );

  // Neto a cuadrar con dinero = pendiente - NCRE aplicadas
  const totalNetoACuadrar = Math.max(0, totalPendienteSeleccion - totalNcreAplicado);

  // Monto sugerido: mínimo entre el NETO (después de NCRE) y lo que tiene el pago
  useEffect(() => {
    if (!seleccionadas.size || !pagoSeleccionado) { setMontoAplicar(''); return; }
    const sugerido = Math.min(totalNetoACuadrar, saldoPago);
    setMontoAplicar(sugerido.toFixed(2));
  }, [seleccionadas, pagoSeleccionado, totalNetoACuadrar, saldoPago]);

  // Helpers NCRE
  const aplicarNcAuto = (nc) => {
    // Aplica la NCRE a la primera factura seleccionada con saldo pendiente > 0
    const facturaTarget = facturasSeleccionadas.find(f => Number(f.saldo_pendiente) > 0);
    if (!facturaTarget) {
      showNotification('Selecciona al menos una factura para aplicar la NCRE', 'error');
      return;
    }
    const max = Math.min(Number(nc.saldo_disponible), Number(facturaTarget.saldo_pendiente));
    setNcreAplicaciones(prev => ({
      ...prev,
      [nc.id]: { factura_id: facturaTarget.id, monto: max },
    }));
  };

  const quitarNc = (nc_id) => {
    setNcreAplicaciones(prev => {
      const next = { ...prev };
      delete next[nc_id];
      return next;
    });
  };

  // ── Helpers selección ─────────────────────────────────────────
  const toggleFactura = (id) => {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (seleccionadas.size === facturasFiltradas.length) {
      setSeleccionadas(new Set());
    } else {
      setSeleccionadas(new Set(facturasFiltradas.map(f => f.id)));
    }
  };

  const clearSeleccion = () => setSeleccionadas(new Set());

  // ── Lógica de vinculación ─────────────────────────────────────
  const montoNum    = Number(montoAplicar) || 0;
  // maxMonto considera las NCRE: el dinero que falta tras aplicarlas
  const maxMonto    = Math.min(totalNetoACuadrar, saldoPago);
  // Si solo hay NCRE y cubren todo, el monto puede ser 0
  const requireMonto = totalNetoACuadrar > 0;
  const montoValido = requireMonto
    ? (montoNum > 0 && montoNum <= maxMonto + 0.001)
    : true;

  const handleVincular = () => {
    if (!seleccionadas.size)  { showNotification('Selecciona al menos una factura', 'error'); return; }
    if (!pagoSeleccionado)    { showNotification('Selecciona un método de pago', 'error'); return; }
    if (!montoValido)         { showNotification('Monto inválido o excede el disponible', 'error'); return; }
    setConfirmOpen(true);
  };

  const confirmarVinculacion = async () => {
    setVinculando(true);
    setConfirmOpen(false);
    try {
      const facturaIds = facturasSeleccionadas.map(f => f.id);

      // Serializar aplicaciones de NCRE para el backend
      const aplicacionesNcArr = Object.entries(ncreAplicaciones).map(([nc_id, ap]) => ({
        nota_credito_id: nc_id,
        factura_id:      ap.factura_id,
        monto_aplicado:  Number(ap.monto),
      }));

      // Siempre usamos batch porque ahora soporta tanto 1 factura como N + NCRE.
      // monto_total_aplicar es el tope que el usuario eligió del cheque/transferencia:
      // si pone menos que el saldo disponible del pago, el resto queda como saldo del método
      // para usarse en otra conciliación.
      await conciliacionesAPI.batch({
        factura_ids:         facturaIds,
        metodo_pago_id:      pagoSeleccionado.id,
        monto_total_aplicar: montoNum > 0 ? montoNum : undefined,
        fecha_conciliacion:  new Date().toISOString().split('T')[0],
        usuario_email:       user.email,
        notas,
        aplicaciones_nc:     aplicacionesNcArr,
      });

      const ncMsg = aplicacionesNcArr.length > 0 ? ` + ${aplicacionesNcArr.length} NCRE aplicada(s)` : '';
      showNotification(
        facturaIds.length === 1
          ? `Conciliación registrada${ncMsg}`
          : `${facturaIds.length} facturas conciliadas${ncMsg}`
      );

      setSeleccionadas(new Set());
      setPagoSeleccionado(null);
      setMontoAplicar('');
      setNotas('');
      setNcreAplicaciones({});
      await Promise.all([loadFacturas(), loadPagos()]);
      if (historialOpen) loadHistorial();
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
      await Promise.all([loadFacturas(), loadPagos()]);
      if (historialOpen) loadHistorial();
    } catch (e) {
      showNotification(e.message, 'error');
    }
  };

  // ── Pago en efectivo ─────────────────────────────────────────
  const abrirEfectivoModal = () => {
    if (!seleccionadas.size) {
      showNotification('Selecciona al menos una factura', 'error');
      return;
    }
    setEfectivoMonto(totalNetoACuadrar.toFixed(2));
    setEfectivoNotas('');
    setEfectivoOpen(true);
  };

  const ejecutarPagoEfectivo = async () => {
    const monto = Number(efectivoMonto);
    if (!monto || monto <= 0) {
      showNotification('Ingresa un monto válido', 'error');
      return;
    }
    if (monto > totalNetoACuadrar + 0.001) {
      showNotification(`El monto excede el neto a cuadrar (${Q(totalNetoACuadrar)})`, 'error');
      return;
    }
    setEfectivoLoading(true);
    try {
      const aplicacionesNcArr = Object.entries(ncreAplicaciones).map(([nc_id, ap]) => ({
        nota_credito_id: nc_id,
        factura_id:      ap.factura_id,
        monto_aplicado:  Number(ap.monto),
      }));

      await conciliacionesAPI.efectivo({
        factura_ids:     facturasSeleccionadas.map(f => f.id),
        monto,
        fecha_pago:      new Date().toISOString().split('T')[0],
        usuario_email:   user.email,
        notas:           efectivoNotas,
        aplicaciones_nc: aplicacionesNcArr,
        descripcion:     `Pago efectivo · ${facturasSeleccionadas.length} factura(s)`,
      });

      const ncMsg = aplicacionesNcArr.length > 0 ? ` + ${aplicacionesNcArr.length} NCRE` : '';
      showNotification(`Pago en efectivo de ${Q(monto)} registrado${ncMsg}`);
      setSeleccionadas(new Set());
      setNcreAplicaciones({});
      setEfectivoOpen(false);
      setEfectivoMonto('');
      setEfectivoNotas('');
      await Promise.all([loadFacturas(), loadPagos()]);
      if (historialOpen) loadHistorial();
    } catch (e) {
      showNotification(e.message, 'error');
    } finally {
      setEfectivoLoading(false);
    }
  };

  const inputCls = 'bg-apple-bg border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text';
  const allSelected = facturasFiltradas.length > 0 && seleccionadas.size === facturasFiltradas.length;

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-apple-text">Conciliación de Pagos</h1>
          <p className="text-sm text-apple-textSecondary mt-0.5">Vincula facturas pendientes con fondos disponibles</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodFilter year={year} month={month} onYearChange={setYear} onMonthChange={setMonth} />
          <Button
            variant="outline" size="sm"
            className={`gap-1.5 ${historialOpen ? 'border-apple-accent text-apple-accent' : ''}`}
            onClick={() => setHistorialOpen(v => !v)}
          >
            <History size={14} />
            Historial
            {historialOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => { loadFacturas(); loadPagos(); }} className="gap-1.5">
            <RefreshCw size={14} /> Actualizar
          </Button>
        </div>
      </div>

      {/* ── Workspace 3 columnas ────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">

        {/* ── Col 1: Facturas pendientes ──────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-apple-text">
              Facturas Pendientes / Parciales
              <span className="ml-2 text-xs text-apple-textSecondary bg-apple-bgSecondary px-2 py-0.5 rounded-full">{facturasFiltradas.length}</span>
            </p>
            {seleccionadas.size > 0 && (
              <button onClick={clearSeleccion} className="flex items-center gap-1 text-xs text-apple-textSecondary hover:text-apple-error transition-apple">
                <X size={12} /> Limpiar ({seleccionadas.size})
              </button>
            )}
          </div>

          {/* Búsqueda principal */}
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-apple-textSecondary pointer-events-none" />
            <input
              className={`${inputCls} w-full pl-8`}
              placeholder="Buscar por emisor, NIT, UUID..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
          </div>

          {/* Panel de filtros avanzados */}
          <div>
            <button
              onClick={() => setFiltrosOpen(v => !v)}
              className="flex items-center gap-1.5 text-xs text-apple-textSecondary hover:text-apple-text transition-apple"
            >
              <Filter size={12} />
              Filtros avanzados
              {filtrosOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {(filtroEmisores || filtroEstado || sortKey !== 'fecha_emision_desc') && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-apple-accent inline-block" />
              )}
            </button>

            {filtrosOpen && (
              <div className="mt-2 space-y-2 p-3 bg-apple-bgSecondary rounded-apple border border-apple-border">
                {/* Filtro por emisor */}
                <div>
                  <label className="text-xs text-apple-textSecondary block mb-1">Emisor / Proveedor</label>
                  <input
                    list="emisores-list"
                    className={`${inputCls} w-full`}
                    placeholder="Filtrar por emisor..."
                    value={filtroEmisores}
                    onChange={e => setFiltroEmisores(e.target.value)}
                  />
                  <datalist id="emisores-list">
                    {emisoresUnicos.map(e => <option key={e} value={e} />)}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Filtro estado */}
                  <div>
                    <label className="text-xs text-apple-textSecondary block mb-1">Estado</label>
                    <select className={`${inputCls} w-full`} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                      <option value="">Todos</option>
                      <option value="pendiente">Pendiente</option>
                      <option value="parcial">Parcial</option>
                    </select>
                  </div>

                  {/* Ordenamiento */}
                  <div>
                    <label className="text-xs text-apple-textSecondary block mb-1">Ordenar por</label>
                    <select className={`${inputCls} w-full`} value={sortKey} onChange={e => setSortKey(e.target.value)}>
                      {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </div>
                </div>

                {(filtroEmisores || filtroEstado || sortKey !== 'fecha_emision_desc') && (
                  <button
                    className="text-xs text-apple-accent hover:underline"
                    onClick={() => { setFiltroEmisores(''); setFiltroEstado(''); setSortKey('fecha_emision_desc'); }}
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Barra de selección total */}
          {seleccionadas.size > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-apple-accent/10 border border-apple-accent/30 rounded-apple text-xs">
              <span className="text-apple-accent font-medium">
                {seleccionadas.size} factura{seleccionadas.size > 1 ? 's' : ''} · pendiente total: {' '}
                <span className="font-bold">{Q(totalPendienteSeleccion)}</span>
              </span>
              {pagoSeleccionado && (
                <span className={`font-medium ${totalPendienteSeleccion > saldoPago ? 'text-apple-warning' : 'text-apple-success'}`}>
                  {totalPendienteSeleccion > saldoPago ? `Pago cubre parcialmente` : `Pago cubre todo`}
                </span>
              )}
            </div>
          )}

          {/* Lista de facturas con checkbox */}
          <div className="space-y-1.5 max-h-[520px] overflow-y-auto pr-1">
            {/* Fila seleccionar todo */}
            {facturasFiltradas.length > 1 && (
              <button
                onClick={toggleAll}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-apple-textSecondary hover:bg-apple-bgSecondary border border-transparent hover:border-apple-border transition-apple"
              >
                {allSelected
                  ? <SquareCheck size={14} className="text-apple-accent shrink-0" />
                  : <Square size={14} className="shrink-0" />}
                {allSelected ? 'Deseleccionar todo' : `Seleccionar todo (${facturasFiltradas.length})`}
              </button>
            )}

            {loadingFacturas ? <Spinner /> : facturasFiltradas.length === 0 ? (
              <EmptyState msg="Sin facturas para los filtros seleccionados" />
            ) : facturasFiltradas.map(f => {
              const isSel = seleccionadas.has(f.id);
              return (
                <div
                  key={f.id}
                  onClick={() => toggleFactura(f.id)}
                  className={`rounded-apple border p-3 cursor-pointer transition-apple flex gap-2.5 items-start ${
                    isSel
                      ? 'border-apple-accent bg-apple-accent/10 shadow-[0_0_0_1px_#2997FF]'
                      : 'border-apple-border bg-apple-bgSecondary hover:border-apple-accent/30 hover:bg-apple-bgSecondary/80'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">
                    {isSel
                      ? <SquareCheck size={15} className="text-apple-accent" />
                      : <Square size={15} className="text-apple-textSecondary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
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
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Col central: Panel de vinculación ──────────────── */}
        <div className="lg:w-72 space-y-3">
          <p className="text-sm font-medium text-apple-text text-center">Vincular</p>

          {/* Resumen facturas seleccionadas */}
          <Card className={`p-4 border-2 transition-apple ${seleccionadas.size ? 'border-apple-accent/40 bg-apple-accent/5' : 'border-dashed border-apple-border'}`}>
            <p className="text-xs text-apple-textSecondary mb-2">
              {seleccionadas.size > 1 ? `${seleccionadas.size} facturas seleccionadas` : 'Factura seleccionada'}
            </p>
            {seleccionadas.size > 0 ? (
              <div className="space-y-1">
                {seleccionadas.size === 1 ? (
                  <p className="text-sm font-medium text-apple-text truncate">
                    {facturasSeleccionadas[0]?.nombre_emisor}
                  </p>
                ) : (
                  <div className="space-y-0.5 max-h-24 overflow-y-auto">
                    {facturasSeleccionadas.map(f => (
                      <p key={f.id} className="text-xs text-apple-textSecondary truncate">· {f.nombre_emisor}</p>
                    ))}
                  </div>
                )}
                <div className="pt-1 space-y-0.5">
                  <p className="text-xs text-apple-textSecondary">
                    Total pendiente:{' '}
                    <span className="text-apple-warning font-semibold">{Q(totalPendienteSeleccion)}</span>
                  </p>
                  {totalNcreAplicado > 0 && (
                    <>
                      <p className="text-xs text-purple-400">
                        − NCRE aplicada:{' '}
                        <span className="font-semibold">{Q(totalNcreAplicado)}</span>
                      </p>
                      <p className="text-xs text-apple-text pt-0.5 border-t border-apple-border/40 mt-0.5">
                        Neto a cuadrar:{' '}
                        <span className="text-apple-success font-bold">{Q(totalNetoACuadrar)}</span>
                      </p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-apple-textSecondary italic">← Selecciona una o varias facturas</p>
            )}
          </Card>

          {/* ── NCRE disponibles para los emisores seleccionados ── */}
          {seleccionadas.size > 0 && (ncreDisponibles.length > 0 || ncreLoading) && (
            <Card className="p-3 border border-purple-400/30 bg-purple-400/5 space-y-2">
              <div className="flex items-center gap-1.5 text-xs">
                <FileMinus size={13} className="text-purple-400" />
                <span className="font-medium text-purple-400">Notas de crédito disponibles</span>
                <span className="text-apple-textSecondary">({ncreDisponibles.length})</span>
              </div>

              {ncreLoading ? (
                <div className="flex items-center justify-center py-2 text-xs text-apple-textSecondary gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Buscando NCRE...
                </div>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {ncreDisponibles.map(nc => {
                    const aplicada = ncreAplicaciones[nc.id];
                    return (
                      <div
                        key={nc.id}
                        className={`flex items-center justify-between text-xs px-2 py-1.5 rounded border transition-apple ${
                          aplicada ? 'bg-purple-400/10 border-purple-400/40' : 'bg-apple-bg border-apple-border'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-apple-text truncate" title={nc.nombre_emisor}>
                            {nc.tipo_dte && <span className="text-purple-400 font-mono mr-1">{nc.tipo_dte}</span>}
                            {nc.nombre_emisor}
                          </p>
                          <p className="text-apple-textSecondary text-[10px]">
                            {fmt(nc.fecha_emision?.split('T')[0])}
                            {' · '}Disponible: <span className="text-purple-400 font-semibold">{Q(nc.saldo_disponible)}</span>
                          </p>
                        </div>
                        {aplicada ? (
                          <button
                            onClick={() => quitarNc(nc.id)}
                            className="ml-2 px-2 py-1 rounded text-purple-400 hover:bg-purple-400/10 flex items-center gap-1"
                            title="Quitar aplicación"
                          >
                            <X size={11} /> {Q(aplicada.monto)}
                          </button>
                        ) : (
                          <button
                            onClick={() => aplicarNcAuto(nc)}
                            className="ml-2 px-2 py-1 rounded text-xs text-purple-400 bg-purple-400/10 hover:bg-purple-400/20 font-medium"
                            title="Aplicar NCRE al cuadre"
                          >
                            Aplicar
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          <div className="flex justify-center">
            <ArrowRight size={18} className="text-apple-textSecondary rotate-90 lg:rotate-0" />
          </div>

          {/* Método de pago seleccionado */}
          <Card className={`p-4 border-2 transition-apple ${pagoSeleccionado ? 'border-apple-success/40 bg-apple-success/5' : 'border-dashed border-apple-border'}`}>
            <p className="text-xs text-apple-textSecondary mb-2">Método de pago seleccionado</p>
            {pagoSeleccionado ? (
              <div className="space-y-1">
                <p className="text-sm font-medium text-apple-text capitalize">
                  {pagoSeleccionado.tipo}{pagoSeleccionado.banco ? ` — ${pagoSeleccionado.banco}` : ''}
                </p>
                {pagoSeleccionado.numero_documento && (
                  <p className="text-xs text-apple-textSecondary">#{pagoSeleccionado.numero_documento}</p>
                )}
                <p className="text-xs text-apple-textSecondary">
                  Disponible: <span className="text-apple-success font-semibold">{Q(pagoSeleccionado.saldo_disponible)}</span>
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-apple-textSecondary italic">→ Selecciona un pago</p>
                {seleccionadas.size > 0 && totalNetoACuadrar > 0 && (
                  <>
                    <div className="flex items-center gap-2 text-[10px] text-apple-textSecondary uppercase tracking-wider">
                      <div className="flex-1 h-px bg-apple-border" />
                      <span>o</span>
                      <div className="flex-1 h-px bg-apple-border" />
                    </div>
                    <button
                      onClick={abrirEfectivoModal}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-apple-warning/40 bg-apple-warning/5 hover:bg-apple-warning/10 text-apple-warning text-xs font-medium transition-apple"
                    >
                      <Banknote size={13} /> Pagar en efectivo ({Q(totalNetoACuadrar)})
                    </button>
                  </>
                )}
              </div>
            )}
          </Card>

          {/* Controles de monto y vinculación */}
          {seleccionadas.size > 0 && pagoSeleccionado && (
            <div className="space-y-3 bg-apple-bgSecondary rounded-apple p-4 border border-apple-border">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setMontoAplicar(Math.min(saldoPago, totalNetoACuadrar).toFixed(2))}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-apple-accent/40 bg-apple-accent/5 hover:bg-apple-accent/10 text-apple-accent text-xs font-medium transition-apple"
                >
                  <Zap size={12} /> Todo el pago
                </button>
                <button
                  onClick={() => saldoPago >= totalNetoACuadrar && setMontoAplicar(totalNetoACuadrar.toFixed(2))}
                  disabled={saldoPago < totalNetoACuadrar}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-apple-success/40 bg-apple-success/5 hover:bg-apple-success/10 text-apple-success text-xs font-medium transition-apple disabled:opacity-40 disabled:cursor-not-allowed"
                  title={saldoPago < totalNetoACuadrar ? `Pago insuficiente — faltan ${Q(totalNetoACuadrar - saldoPago)}` : 'Cubrir todo el neto a cuadrar'}
                >
                  <Target size={12} /> Cubrir neto
                </button>
              </div>

              {seleccionadas.size > 1 && (
                <p className="text-xs text-apple-textSecondary bg-apple-bg rounded-lg px-3 py-2 border border-apple-border">
                  El saldo se distribuirá entre las {seleccionadas.size} facturas en el orden de selección, cubriendo cada una hasta agotarse.
                </p>
              )}

              <div>
                <label className="text-xs text-apple-textSecondary block mb-1">
                  {seleccionadas.size === 1 ? `Monto a aplicar — máx. ${Q(maxMonto)}` : `Saldo disponible del pago`}
                </label>
                {seleccionadas.size === 1 ? (
                  <>
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
                  </>
                ) : (
                  <p className="text-sm font-semibold text-apple-success tabular-nums">{Q(saldoPago)}</p>
                )}
              </div>

              <div>
                <label className="text-xs text-apple-textSecondary block mb-1">Notas (opcional)</label>
                <input
                  className="w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text"
                  placeholder="Observaciones..."
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                />
              </div>

              <Button
                className="w-full gap-2"
                onClick={handleVincular}
                disabled={!montoValido || vinculando}
              >
                {vinculando
                  ? <><RefreshCw size={14} className="animate-spin" /> Vinculando...</>
                  : <><Link2 size={14} />
                      {seleccionadas.size === 1 ? 'Registrar Conciliación' : `Conciliar ${seleccionadas.size} facturas`}
                    </>}
              </Button>
            </div>
          )}

          {(!seleccionadas.size || !pagoSeleccionado) && (
            <p className="text-xs text-apple-textSecondary text-center">
              Selecciona facturas y un pago para continuar
            </p>
          )}
        </div>

        {/* ── Col 3: Pagos disponibles ────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-apple-text">
              Fondos Disponibles
              <span className="ml-2 text-xs text-apple-textSecondary bg-apple-bgSecondary px-2 py-0.5 rounded-full">{pagosDisponibles.length}</span>
            </p>
          </div>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {loadingPagos ? <Spinner /> : pagosDisponibles.length === 0 ? (
              <EmptyState msg="Sin fondos disponibles. Registra un cheque o transferencia." />
            ) : pagosDisponibles.map(p => {
              const isSel = pagoSeleccionado?.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setPagoSeleccionado(isSel ? null : p)}
                  className={`rounded-apple border p-3 cursor-pointer transition-apple ${
                    isSel
                      ? 'border-apple-success bg-apple-success/10 shadow-[0_0_0_1px_#32D74B]'
                      : 'border-apple-border bg-apple-bgSecondary hover:border-apple-success/30 hover:bg-apple-bgSecondary/80'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-apple-text capitalize">{p.tipo}</p>
                      {p.banco && <p className="text-xs text-apple-textSecondary">{p.banco}</p>}
                      {p.numero_documento && <p className="text-xs text-apple-textSecondary">#{p.numero_documento}</p>}
                      {!p.banco && !p.numero_documento && p.descripcion && (
                        <p className="text-xs text-apple-textSecondary truncate">{p.descripcion}</p>
                      )}
                      <p className="text-xs text-apple-textSecondary">{fmt(p.fecha_documento)}</p>
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
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Historial colapsable ─────────────────────────────── */}
      {historialOpen && (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-apple-border flex items-center justify-between">
            <p className="text-sm font-medium text-apple-text flex items-center gap-2">
              <History size={15} className="text-apple-textSecondary" />
              Historial de Conciliaciones
              {historial.length > 0 && (
                <span className="text-xs bg-apple-bgSecondary text-apple-textSecondary px-2 py-0.5 rounded-full">{historial.length}</span>
              )}
            </p>
            <button onClick={() => setHistorialOpen(false)} className="p-1 rounded hover:bg-apple-bgSecondary text-apple-textSecondary hover:text-apple-text transition-apple">
              <X size={15} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-apple-textSecondary text-xs border-b border-apple-border bg-apple-bgSecondary/40">
                  {['Factura (Emisor)', 'Tipo Pago', 'Banco / Ref.', 'Fecha Conc.', 'Monto Aplicado', 'Pendiente Restante', 'Usuario', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-apple-border/40">
                {loadingHistorial ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-apple-textSecondary text-sm">
                    <RefreshCw size={14} className="animate-spin inline mr-1" />Cargando...
                  </td></tr>
                ) : historial.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-apple-textSecondary text-sm">
                    Sin conciliaciones en el período seleccionado
                  </td></tr>
                ) : historial.map(c => (
                  <tr key={c.conciliacion_id} className="hover:bg-apple-bgSecondary/50 transition-apple">
                    <td className="px-4 py-3 max-w-[160px] truncate text-apple-text">{c.nombre_emisor || '—'}</td>
                    <td className="px-4 py-3 capitalize text-apple-textSecondary">{c.tipo_pago || '—'}</td>
                    <td className="px-4 py-3 text-apple-textSecondary text-xs">
                      {c.banco || ''}{c.numero_cheque_o_referencia ? ` #${c.numero_cheque_o_referencia}` : ''}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-apple-textSecondary whitespace-nowrap">
                      {c.fecha_conciliacion ? fmt(c.fecha_conciliacion) : '—'}
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
      )}

      {/* ── Modal de confirmación ────────────────────────────── */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirmar Conciliación" width="max-w-md">
        <div className="space-y-4">
          <div className="bg-apple-bg border border-apple-border rounded-apple p-4 space-y-3 text-sm">
            {seleccionadas.size === 1 ? (
              <Row label="Factura" value={facturasSeleccionadas[0]?.nombre_emisor} />
            ) : (
              <div>
                <span className="text-apple-textSecondary text-sm">{seleccionadas.size} facturas seleccionadas</span>
                <div className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
                  {facturasSeleccionadas.map(f => (
                    <p key={f.id} className="text-xs text-apple-textSecondary pl-2">· {f.nombre_emisor} — {Q(f.saldo_pendiente)}</p>
                  ))}
                </div>
              </div>
            )}
            <Row label="Total pendiente" value={Q(totalPendienteSeleccion)} />
            {totalNcreAplicado > 0 && (
              <>
                <Row label="− NCRE aplicada" value={`${Q(totalNcreAplicado)} (${Object.keys(ncreAplicaciones).length})`} />
                <Row label="= Neto a cuadrar" value={Q(totalNetoACuadrar)} />
              </>
            )}
            <Row label="Método de pago" value={`${pagoSeleccionado?.tipo} ${pagoSeleccionado?.banco || ''}`} />
            <Row label="Saldo disponible pago" value={Q(pagoSeleccionado?.saldo_disponible)} />
            <hr className="border-apple-border" />
            <Row label={seleccionadas.size === 1 ? 'Monto a aplicar' : 'Saldo a distribuir'} value={Q(seleccionadas.size === 1 ? montoAplicar : Math.min(saldoPago, totalNetoACuadrar))} bold />
            {notas && <Row label="Notas" value={notas} />}
          </div>
          {seleccionadas.size > 1 && (
            <p className="text-xs text-apple-textSecondary">
              El saldo disponible del pago se distribuirá entre las {seleccionadas.size} facturas en orden de selección.
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button onClick={confirmarVinculacion} className="gap-1.5">
              <CheckCircle2 size={14} />
              {seleccionadas.size === 1 ? 'Confirmar' : `Confirmar ${seleccionadas.size} facturas`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: pago en efectivo ──────────────────────────── */}
      <Modal
        open={efectivoOpen}
        onClose={efectivoLoading ? () => {} : () => setEfectivoOpen(false)}
        title="Pago en Efectivo"
        width="max-w-md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-apple-warning/10 border border-apple-warning/30 rounded-apple">
            <Banknote size={18} className="text-apple-warning shrink-0 mt-0.5" />
            <p className="text-sm text-apple-text">
              Se creará un método de pago tipo <strong>efectivo</strong> por el monto exacto y se conciliará automáticamente con las facturas seleccionadas.
            </p>
          </div>

          <div className="bg-apple-bg border border-apple-border rounded-apple p-3 space-y-2 text-sm">
            <Row label={`${facturasSeleccionadas.length} factura${facturasSeleccionadas.length !== 1 ? 's' : ''}`} value="" />
            <div className="space-y-0.5 max-h-24 overflow-y-auto">
              {facturasSeleccionadas.map(f => (
                <p key={f.id} className="text-xs text-apple-textSecondary pl-2">· {f.nombre_emisor} — {Q(f.saldo_pendiente)}</p>
              ))}
            </div>
            <hr className="border-apple-border my-1" />
            <Row label="Total pendiente" value={Q(totalPendienteSeleccion)} />
            {totalNcreAplicado > 0 && (
              <>
                <Row label="− NCRE aplicada" value={Q(totalNcreAplicado)} />
                <Row label="= Neto a cuadrar" value={Q(totalNetoACuadrar)} bold />
              </>
            )}
          </div>

          <div>
            <label className="text-xs text-apple-textSecondary block mb-1">
              Monto en efectivo (máx. {Q(totalNetoACuadrar)})
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={totalNetoACuadrar}
              className="w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-warning text-apple-text"
              value={efectivoMonto}
              onChange={e => setEfectivoMonto(e.target.value)}
              disabled={efectivoLoading}
              autoFocus
            />
            <div className="flex gap-2 mt-1.5">
              <button
                onClick={() => setEfectivoMonto(totalNetoACuadrar.toFixed(2))}
                className="text-xs text-apple-accent hover:underline"
                type="button"
              >
                Cubrir todo
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-apple-textSecondary block mb-1">Notas (opcional)</label>
            <input
              className="w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-warning text-apple-text"
              placeholder="Recibo, persona que pagó..."
              value={efectivoNotas}
              onChange={e => setEfectivoNotas(e.target.value)}
              disabled={efectivoLoading}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => setEfectivoOpen(false)} disabled={efectivoLoading}>
              Cancelar
            </Button>
            <Button
              onClick={ejecutarPagoEfectivo}
              disabled={efectivoLoading || !Number(efectivoMonto) || Number(efectivoMonto) > totalNetoACuadrar + 0.001}
              className="gap-1.5"
            >
              {efectivoLoading
                ? <><Loader2 size={14} className="animate-spin" /> Procesando...</>
                : <><Banknote size={14} /> Registrar Pago</>}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-8 text-apple-textSecondary text-sm">
      <RefreshCw size={16} className="animate-spin mr-2" />Cargando...
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div className="text-center py-8 text-apple-textSecondary text-xs border border-dashed border-apple-border rounded-apple">
      {msg}
    </div>
  );
}

function Row({ label, value, bold }) {
  return (
    <div className="flex justify-between">
      <span className="text-apple-textSecondary">{label}</span>
      <span className={bold ? 'font-semibold text-apple-text' : 'text-apple-text'}>{value}</span>
    </div>
  );
}
