import React, { useEffect, useState } from 'react';
import { CreditCard, Banknote, ArrowLeftRight, Coins, FileQuestion, ImageIcon, Download, ExternalLink, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { EstadoBadge } from './EstadoBadge';
import { facturasAPI } from '../../services/api';

const Q = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;

const TIPO_ICON = {
  cheque: CreditCard, transferencia: ArrowLeftRight,
  deposito: Banknote, efectivo: Coins,
};

export function DrillDownModal({ facturaId, open, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedComprobante, setExpandedComprobante] = useState(null); // conciliacion_id

  useEffect(() => {
    if (!open || !facturaId) return;
    setLoading(true);
    setExpandedComprobante(null);
    facturasAPI.get(facturaId)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, facturaId]);

  const factura = data?.factura;
  const conciliaciones = data?.conciliaciones?.filter(c => c.conciliacion_id) ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Detalle de Pago — Drill Down" width="max-w-2xl">
      {loading && <p className="text-apple-textSecondary text-sm text-center py-8">Cargando detalle...</p>}

      {!loading && factura && (
        <div className="space-y-5">
          {/* Cabecera de la factura */}
          <div className="bg-apple-bg rounded-apple p-4 border border-apple-border space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-apple-textSecondary mb-0.5">Número de Autorización SAT</p>
                <p className="font-mono text-xs text-apple-accent break-all">{factura.numero_autorizacion || '—'}</p>
              </div>
              <EstadoBadge estado={factura.estado} />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2 text-sm">
              <Stat label="Emisor" value={factura.nombre_emisor || '—'} />
              <Stat label="Receptor" value={factura.nombre_receptor || '—'} />
              <Stat label="Fecha Emisión" value={factura.fecha_emision ? new Date(factura.fecha_emision).toLocaleDateString('es-GT') : '—'} />
              <Stat label="Tipo" value={factura.tipo_documento} />
            </div>
          </div>

          {/* Barra de progreso de pago */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-apple-textSecondary">Progreso de pago</span>
              <span className="font-medium tabular-nums">
                {Q(factura.monto_pagado)} <span className="text-apple-textSecondary">/ {Q(factura.monto_total)}</span>
              </span>
            </div>
            <div className="h-2 bg-apple-bg rounded-full overflow-hidden border border-apple-border">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, (Number(factura.monto_pagado) / Number(factura.monto_total)) * 100)}%`,
                  background: factura.estado === 'pagada' ? '#32D74B' : factura.estado === 'parcial' ? '#2997FF' : '#FFD60A',
                }}
              />
            </div>
            <div className="flex justify-between text-xs text-apple-textSecondary">
              <span>Saldo pendiente: <span className="text-apple-warning font-medium">{Q(factura.saldo_pendiente)}</span></span>
              <span>{Math.round((Number(factura.monto_pagado) / Number(factura.monto_total)) * 100)}% pagado</span>
            </div>
          </div>

          {/* Historial de conciliaciones */}
          <div>
            <p className="text-sm font-medium text-apple-text mb-3">
              Pagos vinculados ({conciliaciones.length})
            </p>
            {conciliaciones.length === 0 ? (
              <div className="text-center py-8 text-apple-textSecondary text-sm border border-dashed border-apple-border rounded-apple">
                Sin pagos vinculados aún
              </div>
            ) : (
              <div className="space-y-2">
                {conciliaciones.map((c) => {
                  const Icon = TIPO_ICON[c.tipo_pago] ?? FileQuestion;
                  const isExpanded = expandedComprobante === c.conciliacion_id;
                  return (
                    <div key={c.conciliacion_id} className="bg-apple-bg border border-apple-border rounded-apple overflow-hidden">
                      <div className="flex items-center gap-3 p-3">
                        <div className="p-2 bg-apple-bgSecondary rounded-lg shrink-0">
                          <Icon size={16} className="text-apple-accent" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium capitalize">{c.tipo_pago}</p>
                          <p className="text-xs text-apple-textSecondary truncate">
                            {c.banco ? `${c.banco} — ` : ''}{c.numero_cheque_o_referencia || 'Sin referencia'}
                          </p>
                          <p className="text-xs text-apple-textSecondary">
                            {c.fecha_conciliacion ? new Date(c.fecha_conciliacion).toLocaleDateString('es-GT') : '—'}
                            {c.usuario_conciliacion ? ` · ${c.usuario_conciliacion}` : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end gap-1">
                          <p className="text-sm font-semibold text-apple-success tabular-nums">{Q(c.monto_aplicado)}</p>
                          <p className="text-xs text-apple-textSecondary">aplicado</p>
                          {c.url_comprobante && (
                            <button
                              onClick={() => setExpandedComprobante(isExpanded ? null : c.conciliacion_id)}
                              className="flex items-center gap-1 text-xs text-apple-accent hover:underline mt-0.5"
                            >
                              <ImageIcon size={11} />
                              {isExpanded ? 'Ocultar' : 'Ver comprobante'}
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Comprobante expandible */}
                      {isExpanded && c.url_comprobante && (
                        <div className="border-t border-apple-border bg-black/20 p-3 space-y-2">
                          <div className="flex justify-end gap-2 mb-1">
                            <a
                              href={c.url_comprobante}
                              download
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-apple-accent hover:underline"
                            >
                              <Download size={12} /> Descargar
                            </a>
                            <a
                              href={c.url_comprobante}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-apple-textSecondary hover:text-apple-text"
                            >
                              <ExternalLink size={12} /> Abrir
                            </a>
                          </div>
                          <img
                            src={c.url_comprobante}
                            alt="Comprobante del pago"
                            className="w-full max-h-72 object-contain rounded-lg shadow"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-xs text-apple-textSecondary">{label}</p>
      <p className="text-sm text-apple-text truncate">{value}</p>
    </div>
  );
}
