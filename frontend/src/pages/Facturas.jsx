import React, { useState, useEffect, useCallback } from 'react';
import { Eye, RefreshCw, Download, Filter, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EstadoBadge } from '../components/finance/EstadoBadge';
import { PeriodFilter, periodoToRange } from '../components/finance/PeriodFilter';
import { DrillDownModal } from '../components/finance/DrillDownModal';
import { facturasAPI } from '../services/api';

const Q = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
const PAGE_SIZE = 25;

const ESTADOS = ['pendiente', 'parcial', 'pagada', 'anulada'];
const TIPOS   = ['compra', 'venta', 'nota_credito', 'nota_debito'];
const ORIGENES = ['sat_excel', 'ocr_upload', 'manual'];

export function Facturas() {
  const curYear = new Date().getFullYear();
  const [year, setYear]   = useState(String(curYear));
  const [month, setMonth] = useState('');

  const [estado, setEstado]   = useState('');
  const [tipo, setTipo]       = useState('');
  const [origen, setOrigen]   = useState('');
  const [busqueda, setBusqueda] = useState('');

  const [facturas, setFacturas] = useState([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(true);

  const [drillId, setDrillId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { desde, hasta } = periodoToRange(year, month);
      const params = { desde, hasta, page, limit: PAGE_SIZE };
      if (estado)   params.estado         = estado;
      if (tipo)     params.tipo_documento  = tipo;
      if (origen)   params.origen          = origen;
      if (busqueda) params.busqueda        = busqueda;
      const res = await facturasAPI.list(params);
      setFacturas(res.data || []);
      setTotal(res.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [year, month, estado, tipo, origen, busqueda, page]);

  useEffect(() => { setPage(1); }, [year, month, estado, tipo, origen, busqueda]);
  useEffect(() => { load(); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const exportCSV = () => {
    const rows = [['UUID SAT', 'Tipo DTE', 'Emisor', 'NIT Emisor', 'Receptor', 'Fecha', 'Total', 'Pagado', 'Pendiente', 'Estado', 'Origen']];
    facturas.forEach(f => rows.push([
      f.numero_autorizacion, f.tipo_dte, f.nombre_emisor, f.nit_emisor,
      f.nombre_receptor, f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-GT') : '',
      f.monto_total, f.monto_pagado, f.saldo_pendiente, f.estado, f.origen,
    ]));
    const csv = rows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `Facturas_${year}${month ? '-' + month : ''}.csv`;
    a.click();
  };

  const inputCls = 'bg-apple-bg border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-apple-text">Facturas DTE-FEL</h1>
          <p className="text-sm text-apple-textSecondary mt-0.5">{total} registros encontrados</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={exportCSV} variant="outline" size="sm" className="gap-1.5"><Download size={14} /> CSV</Button>
          <Button onClick={() => load()} variant="outline" size="sm" className="gap-1.5"><RefreshCw size={14} /></Button>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Filter size={15} className="text-apple-textSecondary shrink-0" />
          <PeriodFilter year={year} month={month} onYearChange={setYear} onMonthChange={setMonth} />
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-apple-textSecondary" />
            <input
              className={`${inputCls} pl-8 w-48`}
              placeholder="Buscar emisor, NIT, UUID..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
            />
          </div>
          <select className={inputCls} value={estado} onChange={e => setEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
          </select>
          <select className={inputCls} value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="">Tipo de documento</option>
            {TIPOS.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <select className={inputCls} value={origen} onChange={e => setOrigen(e.target.value)}>
            <option value="">Todos los orígenes</option>
            {ORIGENES.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
          </select>
          {(estado || tipo || origen || busqueda) && (
            <button
              className="text-xs text-apple-accent hover:underline"
              onClick={() => { setEstado(''); setTipo(''); setOrigen(''); setBusqueda(''); }}
            >Limpiar filtros</button>
          )}
        </div>
      </Card>

      {/* Tabla */}
      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-apple-textSecondary text-xs border-b border-apple-border bg-apple-bgSecondary/40">
                {['Autorización SAT', 'Emisor', 'Receptor', 'Fecha', 'Total', 'Pagado', 'Pendiente', 'Estado', 'Origen', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-border/40">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-apple-textSecondary text-sm">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />Cargando...
                </td></tr>
              ) : facturas.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-apple-textSecondary text-sm">
                  Sin resultados para los filtros seleccionados.
                </td></tr>
              ) : facturas.map(f => (
                <tr key={f.id} className="hover:bg-apple-bgSecondary/60 transition-apple">
                  <td className="px-4 py-3 font-mono text-xs text-apple-textSecondary max-w-[120px] truncate" title={f.numero_autorizacion}>
                    {f.numero_autorizacion ? f.numero_autorizacion.slice(0, 8) + '…' : '—'}
                  </td>
                  <td className="px-4 py-3 max-w-[160px] truncate text-apple-text">{f.nombre_emisor || '—'}</td>
                  <td className="px-4 py-3 max-w-[140px] truncate text-apple-textSecondary">{f.nombre_receptor || '—'}</td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap text-apple-textSecondary">
                    {f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-GT') : '—'}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium whitespace-nowrap">{Q(f.monto_total)}</td>
                  <td className="px-4 py-3 tabular-nums text-apple-success whitespace-nowrap">{Q(f.monto_pagado)}</td>
                  <td className={`px-4 py-3 tabular-nums whitespace-nowrap font-medium ${Number(f.saldo_pendiente) > 0 ? 'text-apple-warning' : 'text-apple-textSecondary'}`}>
                    {Q(f.saldo_pendiente)}
                  </td>
                  <td className="px-4 py-3"><EstadoBadge estado={f.estado} /></td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-apple-textSecondary">{f.origen?.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setDrillId(f.id)}
                      className="p-1.5 rounded-lg hover:bg-apple-bgSecondary text-apple-textSecondary hover:text-apple-accent transition-apple"
                      title="Ver cómo se pagó esta factura"
                    >
                      <Eye size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginación */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-apple-border text-sm">
            <span className="text-apple-textSecondary">
              Página {page} de {totalPages} · {total} registros
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                <ChevronLeft size={15} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                <ChevronRight size={15} />
              </Button>
            </div>
          </div>
        )}
      </Card>

      <DrillDownModal facturaId={drillId} open={!!drillId} onClose={() => setDrillId(null)} />
    </div>
  );
}
