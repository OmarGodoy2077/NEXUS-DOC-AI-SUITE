import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Bot, Sparkles } from 'lucide-react';
import { Card } from '../components/ui/Card';

export function Processing() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // Simula el tiempo de procesamiento de Gemini Flash 2.5
    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          // TODO: En producción, aquí se recibiría la respuesta del Webhook del backend
          setTimeout(() => navigate(`/viewer/${id}`), 500);
          return 100;
        }
        return p + 5;
      });
    }, 150);

    return () => clearInterval(interval);
  }, [id, navigate]);

  return (
    <div className="h-[80vh] flex items-center justify-center">
      <Card className="w-full max-w-md p-8 text-center relative overflow-hidden">
        {/* Efecto de fondo sutil */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-apple-accent/20 via-apple-accent to-apple-accent/20 animate-pulse"></div>
        
        <div className="relative inline-flex mb-6">
          <div className="w-20 h-20 bg-apple-bgSecondary rounded-full flex items-center justify-center text-apple-accent border-2 border-apple-accent/20">
            <Bot size={40} className={progress > 0 && progress < 100 ? "animate-bounce" : ""} />
          </div>
          <Sparkles className="absolute -top-2 -right-2 text-apple-warning animate-pulse" size={24} />
        </div>

        <h2 className="text-xl font-semibold mb-2">Procesando Documento</h2>
        <p className="text-apple-textSecondary mb-8 text-sm">
          Gemini Flash 2.5 extrayendo entidades estructuradas y generando embeddings vectoriales...
        </p>

        <div className="w-full h-2 bg-apple-bgSecondary rounded-full overflow-hidden mb-2">
          <div 
            className="h-full bg-apple-accent transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <p className="text-xs text-apple-textSecondary text-right font-medium">{progress}% Completado</p>
      </Card>
    </div>
  );
}