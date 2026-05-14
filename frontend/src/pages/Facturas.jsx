import React, { useState, useEffect, useCallback } from 'react';
import { Eye, RefreshCw, Filter, Search, ChevronLeft, ChevronRight, FileSpreadsheet, Trash2, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { EstadoBadge } from '../components/finance/EstadoBadge';
import { PeriodFilter, periodoToRange } from '../components/finance/PeriodFilter';
import { DrillDownModal } from '../components/finance/DrillDownModal';
import { facturasAPI } from '../services/api';
import { useApp } from '../context/AppContext';

const Q = (n) => `Q ${Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}`;
const PAGE_SIZE = 25;

const ESTADOS = ['pendiente', 'parcial', 'pagada', 'anulada'];
const TIPOS   = ['compra', 'venta', 'nota_credito', 'nota_debito'];
const ORIGENES = ['sat_excel', 'ocr_upload', 'manual'];

export function Facturas() {
  const { user, showNotification } = useApp();
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

  // Limpieza de facturas sin relación
  const [cleanOpen,     setCleanOpen]     = useState(false);
  const [cleanPreview,  setCleanPreview]  = useState(null);
  const [cleanLoading,  setCleanLoading]  = useState(false);
  const [cleanDeleting, setCleanDeleting] = useState(false);
  const [cleanConfirm,  setCleanConfirm]  = useState('');
  const [cleanResult,   setCleanResult]   = useState(null);
  const CLEAN_PHRASE = 'ELIMINAR SIN RELACION';

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

  const [exporting, setExporting] = useState(false);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const { default: ExcelJS } = await import('exceljs');
      const { desde, hasta } = periodoToRange(year, month);
      const params = { desde, hasta };
      if (estado)  params.estado  = estado;
      if (origen)  params.origen  = origen;

      const { facturas: allFacturas, conciliaciones: allConcs, aplicaciones_nc: allAplics = [] }
        = await facturasAPI.controlPagos(params);

      // Agrupar conciliaciones por factura_id
      const concByFactura = {};
      allConcs.forEach(c => {
        if (!concByFactura[c.factura_id]) concByFactura[c.factura_id] = [];
        concByFactura[c.factura_id].push(c);
      });

      // Diccionario para acceder a facturas por id (para detalles cruzados)
      const facturaPorId = Object.fromEntries(allFacturas.map(f => [f.id, f]));

      // Aplicaciones de NCRE agrupadas:
      //   - por factura objetivo (factura_id): qué NCRE le restaron saldo
      //   - por NCRE (nota_credito_id): a qué facturas se aplicó esta NCRE
      const ncAplicadasA = {};   // factura_id → [{nc, monto}]
      const ncAplicacionesDe = {}; // nota_credito_id → [{factura, monto}]
      allAplics.forEach(a => {
        const nc = facturaPorId[a.nota_credito_id];
        const fac = facturaPorId[a.factura_id];
        if (nc) {
          (ncAplicacionesDe[a.nota_credito_id] ||= []).push({ factura: fac, monto: Number(a.monto_aplicado) });
        }
        if (fac) {
          (ncAplicadasA[a.factura_id] ||= []).push({ nc, monto: Number(a.monto_aplicado) });
        }
      });

      const wb = new ExcelJS.Workbook();
      wb.creator = 'NEXUS DOC AI SUITE';
      wb.created = new Date();

      const ws = wb.addWorksheet('Control de Pagos', { views: [{ state: 'frozen', ySplit: 1 }] });

      // ── Columnas ────────────────────────────────────────────
      ws.columns = [
        { header: 'UUID SAT',        key: 'uuid',        width: 38 },
        { header: 'Tipo DTE',        key: 'tipo_dte',    width: 10 },
        { header: 'Tipo Doc.',       key: 'tipo_doc_cl', width: 14 },
        { header: 'Emisor',          key: 'emisor',      width: 30 },
        { header: 'NIT Emisor',      key: 'nit',         width: 14 },
        { header: 'Receptor',        key: 'receptor',    width: 30 },
        { header: 'Fecha Emisión',   key: 'fecha',       width: 14 },
        { header: 'Total Factura',   key: 'total',       width: 16 },
        { header: 'Banco',           key: 'banco',       width: 20 },
        { header: 'Tipo Documento',  key: 'tipo_doc',    width: 18 },
        { header: 'Referencia',      key: 'referencia',  width: 32 },
        { header: 'Valor Pagado',    key: 'pagado',      width: 16 },
        { header: 'Saldo Pendiente', key: 'pendiente',   width: 16 },
        { header: 'Estado',          key: 'estado',      width: 12 },
        { header: 'Origen',          key: 'origen',      width: 14 },
      ];

      // Estilo cabecera
      ws.getRow(1).eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D3557' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          bottom: { style: 'medium', color: { argb: 'FF457B9D' } },
        };
      });
      ws.getRow(1).height = 28;

      const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-GT') : '—';
      const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

      // Color por estado/tipo
      const COLOR_PAGADA       = 'FFE8F5E9';  // verde claro
      const COLOR_PARCIAL      = 'FFFEF3C7';  // amarillo claro
      const COLOR_NCRE         = 'FFEDE7F6';  // morado claro
      const COLOR_ANULADA      = 'FFFFEBEE';  // rojo muy claro

      let rowIdx = 2;

      allFacturas.forEach(f => {
        const esNcre = f.tipo_documento === 'nota_credito' || f.estado === 'nota_credito';
        const concs  = concByFactura[f.id] || [];
        const aplicNCs = ncAplicadasA[f.id] || [];          // NCRE que redujeron esta factura
        const usosDeEstaNc = ncAplicacionesDe[f.id] || [];  // (solo si f es NCRE) a qué facturas se aplicó

        let bancoCell, tipoDocCell, referenciaCell, pagadoCell;

        // ── Caso 1: NCRE — mostrar a qué factura se aplicó ──
        if (esNcre) {
          if (usosDeEstaNc.length === 0) {
            bancoCell = '—';
            tipoDocCell = 'Nota crédito';
            referenciaCell = 'Sin aplicar';
            pagadoCell = 0;
          } else {
            // Resumir uso: a qué factura se aplicó y bajo qué método de pago de esa factura
            bancoCell      = '—';
            tipoDocCell    = 'Nota crédito';
            referenciaCell = usosDeEstaNc
              .map(u => {
                const ref = (u.factura?.numero_autorizacion || '').slice(0, 8) + '…';
                return `Aplicada a ${ref}`;
              })
              .join('\n');
            const montos = usosDeEstaNc.map(u => u.monto);
            pagadoCell = montos.length === 1
              ? montos[0]
              : { formula: montos.join('+'), result: montos.reduce((a, b) => a + b, 0) };
          }
        }
        // ── Caso 2: Factura normal — combinar conciliaciones + aplicaciones NCRE ──
        else {
          const partes = []; // descripciones textuales
          const montos = []; // todos los montos para la fórmula suma

          // Conciliaciones (cheque/transferencia/efectivo/depósito)
          concs.forEach(c => {
            const tipo = capitalize(c.tipo_pago);
            const banco = c.banco ? c.banco : '';
            const ref = c.numero_cheque_o_referencia || 'S/N';
            partes.push({ tipo, banco, ref, monto: Number(c.monto_aplicado) || 0 });
            montos.push(Number(c.monto_aplicado) || 0);
          });

          // Aplicaciones de NCRE
          aplicNCs.forEach(a => {
            const refNc = (a.nc?.numero_autorizacion || '').slice(0, 8) + '…';
            partes.push({
              tipo:  'Nota crédito',
              banco: '',
              ref:   `NCRE ${refNc}`,
              monto: a.monto,
            });
            montos.push(a.monto);
          });

          if (partes.length === 0) {
            bancoCell = '—';
            tipoDocCell = '—';
            referenciaCell = '—';
            pagadoCell = 0;
          } else if (partes.length === 1) {
            const p = partes[0];
            bancoCell      = p.banco || '—';
            tipoDocCell    = p.tipo;
            referenciaCell = p.ref;
            pagadoCell     = p.monto;
          } else {
            bancoCell      = [...new Set(partes.map(p => p.banco).filter(Boolean))].join(' / ') || '—';
            tipoDocCell    = [...new Set(partes.map(p => p.tipo).filter(Boolean))].join(' / ');
            referenciaCell = partes.map(p => p.ref).join('\n');
            pagadoCell     = { formula: montos.join('+'), result: montos.reduce((a, b) => a + b, 0) };
          }
        }

        const row = ws.addRow({
          uuid:       f.numero_autorizacion || '—',
          tipo_dte:   f.tipo_dte || '—',
          tipo_doc_cl:(f.tipo_documento || '—').replace('_', ' '),
          emisor:     f.nombre_emisor || '—',
          nit:        f.nit_emisor || '—',
          receptor:   f.nombre_receptor || '—',
          fecha:      fmtDate(f.fecha_emision),
          total:      Number(f.monto_total) || 0,
          banco:      bancoCell,
          tipo_doc:   tipoDocCell,
          referencia: referenciaCell,
          pagado:     pagadoCell,
          pendiente:  Number(f.saldo_pendiente) || 0,
          estado:     capitalize((f.estado || '').replace('_', ' ')),
          origen:     (f.origen || '').replace('_', ' '),
        });

        // Formato numérico
        ['total', 'pagado', 'pendiente'].forEach(key => {
          row.getCell(key).numFmt = '"Q "#,##0.00';
        });

        // Alineaciones
        row.getCell('referencia').alignment = { wrapText: true, vertical: 'top' };
        row.getCell('uuid').font = { color: { argb: 'FF888888' }, size: 10 };

        // Color de fila por tipo/estado (NCRE prevalece sobre estado)
        let rowColor = null;
        if (esNcre)                       rowColor = COLOR_NCRE;
        else if (f.estado === 'pagada')   rowColor = COLOR_PAGADA;
        else if (f.estado === 'parcial')  rowColor = COLOR_PARCIAL;
        else if (f.estado === 'anulada')  rowColor = COLOR_ANULADA;

        if (rowColor) {
          row.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowColor } };
          });
        }

        // Resaltar columna Tipo DTE si es NCRE
        if (esNcre) {
          row.getCell('tipo_dte').font = { bold: true, color: { argb: 'FF6A1B9A' } };
          row.getCell('estado').font = { bold: true, color: { argb: 'FF6A1B9A' } };
        }

        // Borde inferior sutil
        row.eachCell(cell => {
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } };
        });

        // Ajustar altura si hay varias líneas en referencia
        const lineas = (concs.length + aplicNCs.length) || usosDeEstaNc.length || 1;
        if (lineas > 1) row.height = Math.max(30, lineas * 16);
        rowIdx++;
      });

      // Fila de totales
      const totalRow = ws.addRow({
        emisor:   'TOTAL',
        total:    { formula: `SUM(H2:H${rowIdx - 1})`, result: allFacturas.reduce((a, f) => a + (Number(f.monto_total) || 0), 0) },
        pagado:   { formula: `SUM(L2:L${rowIdx - 1})`, result: allFacturas.reduce((a, f) => a + (Number(f.monto_pagado) || 0), 0) },
        pendiente:{ formula: `SUM(M2:M${rowIdx - 1})`, result: allFacturas.reduce((a, f) => a + (Number(f.saldo_pendiente) || 0), 0) },
      });
      totalRow.eachCell(cell => {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D3557' } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      });
      ['total', 'pagado', 'pendiente'].forEach(key => {
        totalRow.getCell(key).numFmt = '"Q "#,##0.00';
      });

      // Descargar
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Control_Pagos_NEXUS_${year}${month ? '-' + month : ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error exportando Excel:', e);
      alert('Error al generar el reporte: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  // ── Limpieza segura de facturas sin relación ──────────────────
  const buildCleanParams = () => {
    const { desde, hasta } = periodoToRange(year, month);
    const params = { desde, hasta };
    if (estado)  params.estado          = estado;
    if (tipo)    params.tipo_documento  = tipo;
    if (origen)  params.origen          = origen;
    return params;
  };

  const openCleanModal = async () => {
    setCleanResult(null);
    setCleanConfirm('');
    setCleanPreview(null);
    setCleanOpen(true);
    setCleanLoading(true);
    try {
      const preview = await facturasAPI.previewSinRelacion(buildCleanParams());
      setCleanPreview(preview);
    } catch (e) {
      showNotification('Error al consultar facturas: ' + e.message, 'error');
      setCleanOpen(false);
    } finally {
      setCleanLoading(false);
    }
  };

  const handleCleanDelete = async () => {
    if (cleanConfirm !== CLEAN_PHRASE) return;
    setCleanDeleting(true);
    try {
      const result = await facturasAPI.eliminarSinRelacion({
        ...buildCleanParams(),
        usuario_email: user?.email,
      });
      setCleanResult(result);
      showNotification(`${result.eliminadas} factura(s) eliminada(s)`, 'success');
      await load();
    } catch (e) {
      showNotification('Error al eliminar: ' + e.message, 'error');
      setCleanResult({ success: false, message: e.message });
    } finally {
      setCleanDeleting(false);
    }
  };

  const closeCleanModal = () => {
    if (cleanDeleting) return;
    setCleanOpen(false);
    setCleanPreview(null);
    setCleanConfirm('');
    setCleanResult(null);
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
          <Button onClick={exportExcel} variant="outline" size="sm" className="gap-1.5" disabled={exporting}>
            <FileSpreadsheet size={14} />
            {exporting ? 'Generando...' : 'Excel'}
          </Button>
          <Button
            onClick={openCleanModal}
            variant="outline"
            size="sm"
            className="gap-1.5 text-apple-error border-apple-error/40 hover:bg-apple-error/10"
            title="Eliminar facturas sin pagos vinculados"
          >
            <Trash2 size={14} /> Limpiar sin relación
          </Button>
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
                {['Autorización SAT', 'Tipo DTE', 'Emisor', 'Receptor', 'Fecha', 'Total', 'Pagado', 'Pendiente', 'Estado', 'Origen', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-apple-border/40">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-apple-textSecondary text-sm">
                  <RefreshCw size={16} className="animate-spin inline mr-2" />Cargando...
                </td></tr>
              ) : facturas.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-apple-textSecondary text-sm">
                  Sin resultados para los filtros seleccionados.
                </td></tr>
              ) : facturas.map(f => (
                <tr key={f.id} className="hover:bg-apple-bgSecondary/60 transition-apple">
                  <td className="px-4 py-3 font-mono text-xs text-apple-textSecondary max-w-[120px] truncate" title={f.numero_autorizacion}>
                    {f.numero_autorizacion ? f.numero_autorizacion.slice(0, 8) + '…' : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {f.tipo_dte
                      ? <span className={`px-1.5 py-0.5 rounded font-mono ${f.tipo_dte === 'NCRE' ? 'bg-purple-400/10 text-purple-400' : 'bg-apple-bgSecondary text-apple-textSecondary'}`}>{f.tipo_dte}</span>
                      : <span className="text-apple-textSecondary">—</span>}
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

      {/* ── Modal de limpieza segura ─────────────────────────── */}
      <Modal
        open={cleanOpen}
        onClose={closeCleanModal}
        title={cleanResult ? 'Limpieza Completada' : 'Eliminar Facturas Sin Relación'}
        width="max-w-md"
      >
        {cleanResult ? (
          <div className="space-y-4">
            <div className={`flex items-start gap-3 p-3 rounded-apple ${
              cleanResult.success
                ? 'bg-apple-success/10 border border-apple-success/30'
                : 'bg-apple-error/10 border border-apple-error/30'
            }`}>
              {cleanResult.success
                ? <CheckCircle2 size={20} className="text-apple-success shrink-0 mt-0.5" />
                : <AlertTriangle size={20} className="text-apple-error shrink-0 mt-0.5" />}
              <div>
                <p className="text-sm font-medium text-apple-text">
                  {cleanResult.success
                    ? `${cleanResult.eliminadas} factura${cleanResult.eliminadas !== 1 ? 's' : ''} eliminada${cleanResult.eliminadas !== 1 ? 's' : ''}`
                    : 'Error al eliminar'}
                </p>
                <p className="text-xs text-apple-textSecondary mt-0.5">{cleanResult.message}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={closeCleanModal}>Cerrar</Button>
            </div>
          </div>
        ) : cleanLoading || !cleanPreview ? (
          <div className="flex flex-col items-center justify-center py-10 text-apple-textSecondary text-sm">
            <Loader2 size={18} className="animate-spin mb-2" />
            Consultando facturas elegibles...
          </div>
        ) : cleanPreview.total_eliminables === 0 ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-apple-bgSecondary border border-apple-border rounded-apple">
              <CheckCircle2 size={18} className="text-apple-success shrink-0 mt-0.5" />
              <p className="text-sm text-apple-text">
                No hay facturas sin relación que se puedan eliminar con los filtros actuales.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={closeCleanModal}>Cerrar</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 bg-apple-warning/10 border border-apple-warning/30 rounded-apple">
              <AlertTriangle size={20} className="text-apple-warning shrink-0 mt-0.5" />
              <div className="text-sm space-y-2">
                <p className="font-medium text-apple-warning">
                  Se eliminarán {cleanPreview.total_eliminables} factura{cleanPreview.total_eliminables !== 1 ? 's' : ''}.
                </p>
                <p className="text-xs text-apple-textSecondary">
                  Solo se eliminarán facturas que cumplen TODAS estas condiciones:
                </p>
                <ul className="text-xs text-apple-textSecondary list-disc list-inside space-y-0.5 pl-1">
                  <li>No tienen ninguna conciliación vinculada</li>
                  <li>Su <code className="text-apple-text">monto_pagado</code> es 0</li>
                  <li>Cumplen los filtros activos en pantalla</li>
                </ul>
              </div>
            </div>

            {/* Desglose por estado */}
            {Object.keys(cleanPreview.por_estado || {}).length > 0 && (
              <div className="bg-apple-bg border border-apple-border rounded-apple p-3 space-y-1.5">
                <p className="text-xs text-apple-textSecondary font-medium mb-1">Desglose por estado:</p>
                {Object.entries(cleanPreview.por_estado).map(([est, count]) => (
                  <div key={est} className="flex justify-between text-sm">
                    <span className="text-apple-textSecondary capitalize">{est}</span>
                    <span className="font-semibold tabular-nums text-apple-text">{count}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-apple-textSecondary mb-1.5">
                Escribe <code className="px-1.5 py-0.5 bg-apple-bgSecondary rounded text-apple-error font-mono text-xs">{CLEAN_PHRASE}</code> para confirmar:
              </label>
              <input
                type="text"
                className="w-full bg-apple-bg border border-apple-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-apple-error text-apple-text font-mono"
                value={cleanConfirm}
                onChange={e => setCleanConfirm(e.target.value)}
                placeholder={CLEAN_PHRASE}
                disabled={cleanDeleting}
                autoFocus
              />
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={closeCleanModal} disabled={cleanDeleting}>
                Cancelar
              </Button>
              <Button
                onClick={handleCleanDelete}
                disabled={cleanConfirm !== CLEAN_PHRASE || cleanDeleting}
                className="gap-1.5 bg-apple-error hover:bg-apple-error/80 border-apple-error disabled:opacity-40"
              >
                {cleanDeleting
                  ? <><Loader2 size={14} className="animate-spin" /> Eliminando...</>
                  : <><Trash2 size={14} /> Eliminar {cleanPreview.total_eliminables}</>}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
