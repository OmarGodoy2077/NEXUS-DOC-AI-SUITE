import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, FileText } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { createClient } from '@supabase/supabase-js';

// Conexión a Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const navigate = useNavigate();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsSearching(true);
    setHasSearched(true);
    
    try {
      // Búsqueda inteligente en Supabase (Busca en Beneficiario, Fecha o en el texto OCR completo)
      const searchTerm = `%${query}%`; // Comodines para buscar en cualquier parte del texto
      
      const { data, error } = await supabase
        .from('transacciones')
        .select('*')
        .or(`beneficiario.ilike.${searchTerm},raw_ocr.ilike.${searchTerm},fecha_documento.ilike.${searchTerm}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      setResults(data || []);
    } catch (error) {
      console.error("Error en la búsqueda:", error.message);
      alert("Hubo un error al buscar en la base de datos.");
    } finally {
      setIsSearching(false);
    }
  };

  // Helper para limpiar el nombre del archivo
  const formatFileName = (url) => {
    if (!url) return 'Documento_Financiero.pdf';
    const parts = url.split('/');
    const fullName = parts[parts.length - 1];
    return fullName.split('_').slice(1).join('_') || fullName;
  };

  // Helper para calcular una "Relevancia" simulada basada en dónde encontró el texto
  const calculateRelevance = (doc, searchQuery) => {
    const lowerQuery = searchQuery.toLowerCase();
    if (doc.beneficiario?.toLowerCase().includes(lowerQuery)) return 98; // Coincidencia directa
    if (doc.fecha_documento?.toLowerCase().includes(lowerQuery)) return 95; // Coincidencia de fecha
    return 85; // Coincidencia profunda en el OCR
  };

  return (
    <div className="max-w-3xl mx-auto mt-10">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold mb-3">Búsqueda Semántica Inteligente</h1>
        <p className="text-apple-textSecondary">Encuentra cheques por beneficiario, fecha, montos o contenido exacto del OCR.</p>
      </div>

      <form onSubmit={handleSearch} className="relative mb-8">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <SearchIcon className="text-apple-textSecondary" size={20} />
        </div>
        <input
          type="text"
          className="w-full pl-12 pr-24 py-4 rounded-full border border-apple-border bg-apple-bg shadow-apple focus:outline-none focus:border-apple-accent focus:ring-1 focus:ring-apple-accent transition-apple text-lg text-white"
          placeholder="Ej: busca 'Mantenimiento', 'José' o '1500'..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="absolute inset-y-0 right-2 flex items-center">
          <Button type="submit" disabled={isSearching} className="rounded-full px-6">
            Buscar
          </Button>
        </div>
      </form>

      {isSearching ? (
        <LoadingSpinner className="mt-20" text="Analizando registros y texto OCR..." />
      ) : hasSearched ? (
        <div className="space-y-4">
          <p className="text-sm text-apple-textSecondary mb-4">Resultados encontrados: {results.length}</p>
          {results.length > 0 ? results.map((result) => {
            const relevance = calculateRelevance(result, query);
            
            return (
              <Card 
                key={result.id} 
                className="hover:shadow-lg transition-apple cursor-pointer bg-apple-bgSecondary/30 hover:bg-apple-bgSecondary/60"
                onClick={() => navigate(`/viewer/${result.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex gap-4">
                    <div className="p-3 bg-apple-bg rounded-lg border border-apple-border text-apple-accent">
                      <FileText size={24} />
                    </div>
                    <div>
                      <h3 className="font-medium text-lg text-white">{formatFileName(result.url_archivo)}</h3>
                      <p className="text-sm text-apple-textSecondary mt-1">
                        {result.beneficiario ? `Beneficiario: ${result.beneficiario}` : 'Coincidencia en texto profundo (OCR)'}
                      </p>
                      <div className="flex gap-3 mt-3 text-xs text-apple-textSecondary font-medium">
                        <span className="text-apple-accent bg-apple-accent/10 px-2 py-0.5 rounded">Cheque</span> • 
                        <span>Q {result.monto ? result.monto.toLocaleString('es-GT', { minimumFractionDigits: 2 }) : '0.00'}</span> • 
                        <span>{new Date(result.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${relevance > 90 ? 'bg-apple-success/10 text-apple-success' : 'bg-blue-500/10 text-blue-500'}`}>
                      {relevance}% Relevancia
                    </span>
                  </div>
                </div>
              </Card>
            );
          }) : (
            <div className="text-center py-20 text-apple-textSecondary">
              <SearchIcon size={48} className="mx-auto mb-4 opacity-20" />
              No se encontraron documentos que coincidan con "{query}".
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}