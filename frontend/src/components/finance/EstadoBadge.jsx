import React from 'react';
import { Clock, AlertCircle, CheckCircle2, Ban, FileMinus, FilePlus } from 'lucide-react';

const CONFIG = {
  pendiente:        { label: 'Pendiente',    color: 'text-apple-warning  bg-apple-warning/10  border-apple-warning/20',  Icon: Clock },
  parcial:          { label: 'Parcial',      color: 'text-blue-400       bg-blue-400/10       border-blue-400/20',        Icon: AlertCircle },
  pagada:           { label: 'Pagada',       color: 'text-apple-success  bg-apple-success/10  border-apple-success/20',   Icon: CheckCircle2 },
  anulada:          { label: 'Anulada',      color: 'text-apple-error    bg-apple-error/10    border-apple-error/20',     Icon: Ban },
  nota_credito:     { label: 'Nota Crédito', color: 'text-purple-400     bg-purple-400/10     border-purple-400/20',      Icon: FileMinus },
  borrador:         { label: 'Borrador',     color: 'text-apple-textSecondary bg-apple-bgSecondary border-apple-border',  Icon: Clock },
  disponible:       { label: 'Disponible',   color: 'text-apple-success  bg-apple-success/10  border-apple-success/20',   Icon: CheckCircle2 },
  utilizado_parcial:{ label: 'Parcial',      color: 'text-blue-400       bg-blue-400/10       border-blue-400/20',        Icon: AlertCircle },
  utilizado_total:  { label: 'Agotado',      color: 'text-apple-textSecondary bg-apple-bgSecondary border-apple-border',  Icon: Ban },
  anulado:          { label: 'Anulado',      color: 'text-apple-error    bg-apple-error/10    border-apple-error/20',     Icon: Ban },
};

export function EstadoBadge({ estado, size = 'sm' }) {
  const cfg = CONFIG[estado] ?? { label: estado, color: 'text-apple-textSecondary bg-apple-bgSecondary border-apple-border', Icon: Clock };
  const { label, color, Icon } = cfg;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${color}`}>
      <Icon size={size === 'sm' ? 11 : 13} />
      {label}
    </span>
  );
}
