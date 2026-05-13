import React from 'react';
import { CalendarDays } from 'lucide-react';

const MESES = [
  { v: '01', l: 'Enero' }, { v: '02', l: 'Febrero' }, { v: '03', l: 'Marzo' },
  { v: '04', l: 'Abril' }, { v: '05', l: 'Mayo' },    { v: '06', l: 'Junio' },
  { v: '07', l: 'Julio' }, { v: '08', l: 'Agosto' },  { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre' },{ v: '11', l: 'Noviembre' },{ v: '12', l: 'Diciembre' },
];

function buildYears() {
  const cur = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => cur - i);
}

/**
 * PeriodFilter — filtro reutilizable de año + mes
 * Props: year, month, onYearChange, onMonthChange
 * month: '' = todos los meses
 */
export function PeriodFilter({ year, month, onYearChange, onMonthChange, className = '' }) {
  const select = 'bg-apple-bg border border-apple-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-apple-accent text-apple-text';

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <CalendarDays size={16} className="text-apple-textSecondary shrink-0" />
      <select className={select} value={year} onChange={e => onYearChange(e.target.value)}>
        {buildYears().map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select className={select} value={month} onChange={e => onMonthChange(e.target.value)}>
        <option value="">Todos los meses</option>
        {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
      </select>
    </div>
  );
}

/** Convierte year + month en {desde, hasta} ISO para las APIs */
export function periodoToRange(year, month) {
  if (!month) {
    return { desde: `${year}-01-01`, hasta: `${year}-12-31T23:59:59` };
  }
  const lastDay = new Date(year, Number(month), 0).getDate();
  return { desde: `${year}-${month}-01`, hasta: `${year}-${month}-${lastDay}T23:59:59` };
}

export const MESES_LABEL = Object.fromEntries(MESES.map(m => [m.v, m.l]));
export const MESES_LIST = MESES;
