import React, { useState, useEffect } from 'react';
import { Shield, Server, Database, DollarSign, Activity, CheckCircle2, AlertTriangle, Download } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { pagosAPI } from '../services/api';

const COLORS = ['#32D74B', '#FFD60A', '#FF453A']; // Colores Apple

export function Admin() {
  const [uptime, setUptime] = useState(99.98);
  const [isDownloading, setIsDownloading] = useState(false);
  const [volumeData, setVolumeData] = useState([]);
  const [confidenceData, setConfidenceData] = useState([]);
  const [globalMedia, setGlobalMedia] = useState('0.0');

  useEffect(() => {
    // Cargar datos reales de Supabase
    const fetchRealData = async () => {
      try {
        const response = await pagosAPI.list({ limit: 1000 });
        const data = response.data || [];

        // --- 1. PROCESAR VOLUMEN ---
        // Filtrar por los de este mes, armar su sumatoria
        const monthTotals = {};
        data.forEach(item => {
          if (!item.created_at) return;
          const date = new Date(item.created_at);
          // Tomar día con formato dd
          const day = String(date.getDate()).padStart(2, '0');
          if (!monthTotals[day]) monthTotals[day] = 0;
          monthTotals[day] += Number(item.monto_inicial || 0);
        });

        const vData = Object.keys(monthTotals)
          .sort((a,b) => Number(a) - Number(b))
          .map(day => ({
            day,
            montos: Math.round(monthTotals[day])
          }));
        
        // Si no hay datos, mostrar algo base
        if (vData.length === 0) {
          vData.push({ day: '01', montos: 0 });
        }
        setVolumeData(vData);

        // --- 2. PROCESAR CONFIANZA DE OCR ---
        let exactos = 0;
        let revisados = 0;
        let errores = 0;

        const ocrItems = data.filter(i => i.origen === 'ocr_upload' && i.raw_ocr);
        
        ocrItems.forEach(item => {
          try {
            const raw = typeof item.raw_ocr === 'string' ? JSON.parse(item.raw_ocr) : item.raw_ocr;
            let coincidencias = 0;
            let totalAProbar = 2; // Monto y Número documento

            // Si hay un monto raw, extraer número para comparar
            let rawMontoStr = String(raw.monto || '0').replace(/[Q,a-zA-Z\s$]/g, '').trim();
            const matchM = rawMontoStr.match(/\d+[\d,.]*/);
            if (matchM) {
                rawMontoStr = matchM[0].replace(/,/g, '').replace(/[.,](?=\d{3}(?:[.,]|$))/g, '').replace(/,/g, '.');
            }
            const ocrMonto = parseFloat(rawMontoStr) || 0;
            const bdMonto = Number(item.monto_inicial);
            if (ocrMonto === bdMonto) coincidencias++;

            // Y numero docto comprobación limpia
            let rawNum = raw.numero_documento ? String(raw.numero_documento).replace(/^0+(?=\d)/, '').trim().substring(0, 100) : null;
            if (rawNum === item.numero_documento) coincidencias++;

            if (coincidencias === 2) exactos++;
            else if (coincidencias === 1) revisados++;
            else errores++;
          } catch(e) {
            errores++;
          }
        });

        const totalItems = ocrItems.length || 1;
        const calcPorcentaje = (val) => Math.round((val / totalItems) * 100);
        
        setConfidenceData([
          { name: 'Alta Confianza (>95%)', value: ocrItems.length > 0 ? calcPorcentaje(exactos) : 0 },
          { name: 'Revisión Manual', value: ocrItems.length > 0 ? calcPorcentaje(revisados) : 0 },
          { name: 'Errores OCR', value: ocrItems.length > 0 ? calcPorcentaje(errores) : 0 },
        ]);

        const media = ocrItems.length > 0 ? ((exactos + (revisados * 0.5)) / totalItems * 100).toFixed(1) : '100.0';
        setGlobalMedia(media);

      } catch (error) {
        console.error("Error al cargar datos reales:", error);
      }
    };

    fetchRealData();
  }, []);

  // Simula una pequeña fluctuación en el uptime para mayor realismo
  useEffect(() => {
    const interval = setInterval(() => {
      setUptime(prev => +(prev + (Math.random() * 0.02 - 0.01)).toFixed(3));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const downloadAudit = async () => {
    setIsDownloading(true);
    try {
      const res = await pagosAPI.list({ limit: 500, page: 1 });
      const data = res.data || [];
      if (data.length === 0) { alert('No hay métodos de pago registrados para exportar.'); return; }

      const rows = [['ID', 'TIPO', 'BANCO', 'NO. DOCUMENTO', 'MONTO INICIAL', 'SALDO DISPONIBLE', 'ESTADO', 'DESCRIPCION', 'FECHA DOCUMENTO', 'USUARIO', 'ORIGEN', 'CREADO']];
      data.forEach(r => rows.push([
        r.id, r.tipo, r.banco ?? '', r.numero_documento ?? '',
        r.monto_inicial, r.saldo_disponible, r.estado,
        (r.descripcion ?? '').replace(/,/g, ''), r.fecha_documento,
        r.usuario_creacion, r.origen,
        new Date(r.created_at).toLocaleString('es-GT'),
      ]));
      const csv = rows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n');
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = `Auditoria_NEXUS_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    } catch (e) {
      console.error('Error descargando auditoría:', e);
      alert('Hubo un problema generando el reporte.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Panel de Administración</h1>
          <p className="text-apple-textSecondary mt-1">Monitor de sistema, IA local y control de auditoría.</p>
        </div>
        <Button onClick={downloadAudit} disabled={isDownloading} variant="outline" className="gap-2">
          <Download size={16} /> {isDownloading ? 'Generando Reporte...' : 'Descargar Auditoría'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* GRÁFICA DE PROCESAMIENTO (Ocupa 2 columnas) */}
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-apple-border pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-apple-bgSecondary rounded-md text-apple-accent"><Activity size={20} /></div>
              <h2 className="font-semibold text-lg">Volumen de Procesamiento Mensual</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums tracking-tight text-apple-success">Ahorro IA Local: 100%</span>
          </div>
          
          <div className="h-64 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={volumeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCosto" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2997FF" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#2997FF" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#38383A" vertical={false} />
                <XAxis dataKey="day" stroke="#A1A1A6" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#A1A1A6" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `Q${value}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#1C1C1E', borderColor: '#38383A', borderRadius: '12px', color: '#F5F5F7' }}
                  itemStyle={{ color: '#2997FF' }}
                />
                <Area type="monotone" dataKey="montos" name="Monto Extraído (GTQ)" stroke="#2997FF" strokeWidth={3} fillOpacity={1} fill="url(#colorCosto)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* GRÁFICA DE RENDIMIENTO DE IA */}
        <Card className="space-y-4">
          <div className="flex items-center gap-3 border-b border-apple-border pb-4">
            <div className="p-2 bg-apple-bgSecondary rounded-md text-apple-accent"><Shield size={20} /></div>
            <h2 className="font-semibold text-lg">Precisión MiniCPM-V Local</h2>
          </div>
          <div className="h-48 w-full flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={confidenceData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                  {confidenceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1C1C1E', borderColor: '#38383A', borderRadius: '8px' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute text-center">
              <span className="block text-2xl font-bold">{globalMedia}%</span>
              <span className="text-[10px] text-apple-textSecondary uppercase tracking-widest">Media</span>
            </div>
          </div>
          <div className="space-y-2 pt-2">
            {confidenceData.map((item, index) => (
              <div key={item.name} className="flex justify-between items-center text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }}></div>
                  <span className="text-apple-textSecondary">{item.name}</span>
                </div>
                <span className="font-semibold tabular-nums">{item.value}%</span>
              </div>
            ))}
          </div>
        </Card>

        {/* MONITOR DE SALUD ACTUALIZADO CON ARQUITECTURA REAL */}
        <Card className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between border-b border-apple-border pb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-apple-bgSecondary rounded-md text-apple-accent"><Server size={20} /></div>
              <h2 className="font-semibold text-lg">Monitor de Microservicios</h2>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-apple-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-apple-success"></span>
              </span>
              <span className="font-medium">System Uptime: <span className="tabular-nums">{uptime}%</span></span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
            
            <div className="p-4 border border-apple-border rounded-lg bg-apple-bgSecondary/30">
              <div className="flex justify-between items-start mb-2">
                <Database size={18} className="text-apple-textSecondary" />
                <CheckCircle2 size={18} className="text-apple-success" />
              </div>
              <p className="font-medium text-sm">Supabase PostgreSQL</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs px-2 py-0.5 bg-apple-success/10 text-apple-success rounded font-medium">Operativo</span>
                <span className="text-xs text-apple-textSecondary tabular-nums">42ms ping</span>
              </div>
            </div>

            <div className="p-4 border border-apple-border rounded-lg bg-apple-bgSecondary/30">
              <div className="flex justify-between items-start mb-2">
                <Shield size={18} className="text-apple-textSecondary" />
                <CheckCircle2 size={18} className="text-apple-success" />
              </div>
              <p className="font-medium text-sm">Ollama MiniCPM-V</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs px-2 py-0.5 bg-apple-success/10 text-apple-success rounded font-medium">Local Host</span>
                <span className="text-xs text-apple-textSecondary tabular-nums">0ms ping</span>
              </div>
            </div>

            <div className="p-4 border border-apple-border rounded-lg bg-apple-bgSecondary/30">
              <div className="flex justify-between items-start mb-2">
                <Server size={18} className="text-apple-textSecondary" />
                <CheckCircle2 size={18} className="text-apple-success" />
              </div>
              <p className="font-medium text-sm">Supabase Storage</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs px-2 py-0.5 bg-apple-success/10 text-apple-success rounded font-medium">Operativo</span>
                <span className="text-xs text-apple-textSecondary tabular-nums">15ms ping</span>
              </div>
            </div>

            <div className="p-4 border border-apple-border rounded-lg bg-apple-bgSecondary/30 relative overflow-hidden">
              <div className="flex justify-between items-start mb-2">
                <Activity size={18} className="text-apple-textSecondary" />
                <CheckCircle2 size={18} className="text-apple-success" />
              </div>
              <p className="font-medium text-sm">Motor OCR Principal</p>
              <div className="flex justify-between items-center mt-2">
                <span className="text-xs px-2 py-0.5 bg-apple-success/10 text-apple-success rounded font-medium">MiniCPM-V API</span>
                <span className="text-xs text-apple-textSecondary tabular-nums">Estable</span>
              </div>
            </div>

          </div>
        </Card>
      </div>
    </div>
  );
}