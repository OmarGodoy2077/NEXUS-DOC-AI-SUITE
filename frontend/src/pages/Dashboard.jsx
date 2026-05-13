import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  FileText, DollarSign, Clock, CheckCircle2, AlertCircle,
  RefreshCw, Download, TrendingUp, ArrowRight, FileSpreadsheet
} from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EstadoBadge } from '../components/finance/EstadoBadge';
import { PeriodFilter, periodoToRange, MESES_LIST, MESES_LABEL } from '../components/finance/PeriodFilter';
import { facturasAPI, metricsAPI } from '../services/api';

const Q = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
const PIE_COLORS = { pendiente: '#FFD60A', parcial: '#2997FF', pagada: '#32D74B', anulada: '#FF453A' };

export function Dashboard() {
  const navigate = useNavigate();
  const curYear = new Date().getFullYear();

  const [year, setYear]   = useState(String(curYear));
  const [month, setMonth] = useState('');
  const [facturas, setFacturas]   = useState([]);
  const [globalMetrics, setGlobalMetrics] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const { desde, hasta } = periodoToRange(year, month);
      const [facturasRes, metricsRes] = await Promise.all([
        facturasAPI.list({ desde, hasta, limit: 500, page: 1 }),
        metricsAPI.get(),
      ]);
      setFacturas(facturasRes.data || []);
      setGlobalMetrics(metricsRes);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [year, month]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── KPIs del período seleccionado ───────────────────────
  const kpis = useMemo(() => {
    const total     = facturas.reduce((s, f) => s + Number(f.monto_total), 0);
    const pagado    = facturas.reduce((s, f) => s + Number(f.monto_pagado), 0);
    const pendiente = facturas.reduce((s, f) => s + Number(f.saldo_pendiente), 0);
    const byEstado  = facturas.reduce((acc, f) => { acc[f.estado] = (acc[f.estado] || 0) + 1; return acc; }, {});
    return { total, pagado, pendiente, count: facturas.length, byEstado };
  }, [facturas]);

  // ── Datos para gráfica de barras (por mes si año, por semana si mes) ──
  const barData = useMemo(() => {
    if (month) {
      // Un mes seleccionado → agrupar por semana
      const weeks = {};
      facturas.forEach(f => {
        const d = new Date(f.fecha_emision);
        const w = Math.ceil(d.getDate() / 7);
        const key = `Sem ${w}`;
        if (!weeks[key]) weeks[key] = { name: key, total: 0, pagado: 0, pendiente: 0 };
        weeks[key].total    += Number(f.monto_total);
        weeks[key].pagado   += Number(f.monto_pagado);
        weeks[key].pendiente+= Number(f.saldo_pendiente);
      });
      return Object.values(weeks).sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Año completo → agrupar por mes
      const months = {};
      MESES_LIST.forEach(m => { months[m.v] = { name: m.l.slice(0, 3), total: 0, pagado: 0, pendiente: 0 }; });
      facturas.forEach(f => {
        const m = new Date(f.fecha_emision).toISOString().slice(5, 7);
        if (months[m]) {
          months[m].total    += Number(f.monto_total);
          months[m].pagado   += Number(f.monto_pagado);
          months[m].pendiente+= Number(f.saldo_pendiente);
        }
      });
      return Object.values(months);
    }
  }, [facturas, month]);

  // ── Datos para pie de estados ────────────────────────────
  const pieData = useMemo(() =>
    Object.entries(kpis.byEstado)
      .map(([estado, count]) => ({ name: estado, value: count, color: PIE_COLORS[estado] ?? '#A1A1A6' }))
  , [kpis.byEstado]);

  const exportCSV = () => {
    const rows = [['Emisor', 'Receptor', 'Fecha', 'Monto Total', 'Pagado', 'Pendiente', 'Estado']];
    facturas.forEach(f => rows.push([
      f.nombre_emisor, f.nombre_receptor,
      f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-GT') : '',
      f.monto_total, f.monto_pagado, f.saldo_pendiente, f.estado,
    ]));
    const csv = rows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `NEXUS_Dashboard_${year}${month ? '-' + month : ''}.csv`;
    a.click();
  };

  const periodoLabel = month ? `${MESES_LABEL[month]} ${year}` : `Año ${year}`;

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-apple-textSecondary text-sm gap-2">
      <RefreshCw size={16} className="animate-spin" /> Cargando datos financieros...
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Encabezado + controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-apple-text">Dashboard Financiero</h1>
          <p className="text-sm text-apple-textSecondary mt-0.5">{periodoLabel} · {kpis.count} facturas</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter year={year} month={month} onYearChange={setYear} onMonthChange={setMonth} />
          <Button onClick={exportCSV} variant="outline" size="sm" className="gap-1.5">
            <Download size={14} /> CSV
          </Button>
          <Button onClick={() => loadData(true)} variant="outline" size="sm" className="gap-1.5" disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={FileText} iconColor="blue" label="Total Facturas" value={kpis.count} />
        <KpiCard icon={DollarSign} iconColor="green" label={`Monto Total (${periodoLabel})`} value={Q(kpis.total)} mono />
        <KpiCard icon={CheckCircle2} iconColor="green" label="Monto Pagado" value={Q(kpis.pagado)} mono />
        <KpiCard icon={Clock} iconColor="yellow" label="Saldo Pendiente" value={Q(kpis.pendiente)} mono highlight={kpis.pendiente > 0} />
      </div>

      {/* Cards de estado rápido */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { estado: 'pendiente', label: 'Pendientes', color: 'border-apple-warning/30 bg-apple-warning/5' },
          { estado: 'parcial',   label: 'Parciales',  color: 'border-blue-400/30 bg-blue-400/5' },
          { estado: 'pagada',    label: 'Pagadas',    color: 'border-apple-success/30 bg-apple-success/5' },
          { estado: 'anulada',   label: 'Anuladas',   color: 'border-apple-error/30 bg-apple-error/5' },
        ].map(({ estado, label, color }) => (
          <div key={estado} className={`rounded-apple border p-4 ${color}`}>
            <EstadoBadge estado={estado} />
            <p className="text-2xl font-semibold mt-2 tabular-nums">{kpis.byEstado[estado] ?? 0}</p>
            <p className="text-xs text-apple-textSecondary">{label}</p>
          </div>
        ))}
      </div>

      {/* Gráficas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Barra: Evolución de montos */}
        <Card className="lg:col-span-2 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-medium text-apple-text text-sm">Evolución de Montos</p>
              <p className="text-xs text-apple-textSecondary">
                {month ? `Semanas de ${MESES_LABEL[month]}` : `Meses de ${year}`}
              </p>
            </div>
            <TrendingUp size={16} className="text-apple-textSecondary" />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} barGap={4} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#38383A" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#A1A1A6', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#A1A1A6', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
              <Tooltip
                contentStyle={{ background: '#1C1C1E', border: '1px solid #38383A', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#F5F5F7' }}
                formatter={(v, n) => [Q(v), n === 'total' ? 'Total' : n === 'pagado' ? 'Pagado' : 'Pendiente']}
              />
              <Bar dataKey="total"    fill="#2997FF" radius={[4,4,0,0]} name="total" />
              <Bar dataKey="pagado"   fill="#32D74B" radius={[4,4,0,0]} name="pagado" />
              <Bar dataKey="pendiente" fill="#FFD60A" radius={[4,4,0,0]} name="pendiente" />
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-xs text-apple-textSecondary">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#2997FF] inline-block" />Total</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#32D74B] inline-block" />Pagado</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[#FFD60A] inline-block" />Pendiente</span>
          </div>
        </Card>

        {/* Pie: distribución de estados */}
        <Card className="p-5">
          <p className="font-medium text-apple-text text-sm mb-1">Por Estado</p>
          <p className="text-xs text-apple-textSecondary mb-4">{periodoLabel}</p>
          {pieData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-apple-textSecondary text-xs">Sin datos</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#1C1C1E', border: '1px solid #38383A', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, n) => [v, n]}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: '#A1A1A6' }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Tabla reciente */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-apple-border">
          <p className="font-medium text-sm text-apple-text">Facturas Recientes — {periodoLabel}</p>
          <Button variant="ghost" size="sm" onClick={() => navigate('/facturas')} className="gap-1 text-apple-accent text-xs">
            Ver todas <ArrowRight size={13} />
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-apple-textSecondary text-xs border-b border-apple-border bg-apple-bgSecondary/40">
                {['Emisor', 'Receptor', 'Fecha', 'Monto Total', 'Pagado', 'Pendiente', 'Estado'].map(h => (
                  <th key={h} className="px-5 py-3 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-border/40">
              {facturas.slice(0, 10).map(f => (
                <tr key={f.id} className="hover:bg-apple-bgSecondary/60 transition-apple cursor-pointer"
                    onClick={() => navigate('/facturas')}>
                  <td className="px-5 py-3 text-apple-text max-w-[160px] truncate">{f.nombre_emisor || '—'}</td>
                  <td className="px-5 py-3 text-apple-textSecondary max-w-[160px] truncate">{f.nombre_receptor || '—'}</td>
                  <td className="px-5 py-3 text-apple-textSecondary tabular-nums whitespace-nowrap">
                    {f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-GT') : '—'}
                  </td>
                  <td className="px-5 py-3 tabular-nums font-medium">{Q(f.monto_total)}</td>
                  <td className="px-5 py-3 tabular-nums text-apple-success">{Q(f.monto_pagado)}</td>
                  <td className="px-5 py-3 tabular-nums text-apple-warning">{Q(f.saldo_pendiente)}</td>
                  <td className="px-5 py-3"><EstadoBadge estado={f.estado} /></td>
                </tr>
              ))}
              {facturas.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-apple-textSecondary text-sm">
                  Sin facturas en {periodoLabel}. <button className="text-apple-accent hover:underline" onClick={() => navigate('/importar-excel')}>Importar Excel SAT</button>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Accesos rápidos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <QuickLink icon={FileSpreadsheet} label="Importar Excel SAT" desc="Subir reporte de Agencia Virtual" onClick={() => navigate('/importar-excel')} />
        <QuickLink icon={ArrowRight} label="Conciliar Pagos" desc="Vincular cheques a facturas" onClick={() => navigate('/conciliacion')} />
        <QuickLink icon={FileText} label="Ver Facturas" desc="Listado completo con filtros" onClick={() => navigate('/facturas')} />
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, iconColor, label, value, mono, highlight }) {
  const colors = { blue: 'text-blue-400 bg-blue-400/10', green: 'text-apple-success bg-apple-success/10', yellow: 'text-apple-warning bg-apple-warning/10' };
  return (
    <Card className="flex items-center gap-4">
      <div className={`p-3 rounded-full shrink-0 ${colors[iconColor]}`}><Icon size={20} /></div>
      <div className="min-w-0">
        <p className="text-xs text-apple-textSecondary truncate">{label}</p>
        <p className={`text-xl font-semibold truncate ${mono ? 'tabular-nums' : ''} ${highlight ? 'text-apple-warning' : 'text-apple-text'}`}>{value}</p>
      </div>
    </Card>
  );
}

function QuickLink({ icon: Icon, label, desc, onClick }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 p-4 bg-apple-bgSecondary border border-apple-border rounded-apple hover:border-apple-accent/40 hover:bg-apple-bgSecondary/80 transition-apple text-left w-full group">
      <div className="p-2 bg-apple-accent/10 rounded-lg shrink-0 group-hover:bg-apple-accent/20 transition-apple">
        <Icon size={18} className="text-apple-accent" />
      </div>
      <div>
        <p className="text-sm font-medium text-apple-text">{label}</p>
        <p className="text-xs text-apple-textSecondary">{desc}</p>
      </div>
    </button>
  );
}
