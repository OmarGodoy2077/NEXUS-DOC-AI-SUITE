import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fingerprint, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { createClient } from '@supabase/supabase-js';

// Inicializamos Supabase para el Frontend usando variables de Vite
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export function Login() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(''); // Para mostrar errores reales

  // Estados para capturar los inputs
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');
    
    try {
      // Petición real a Supabase Auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) {
        throw error;
      }

      console.log('Sesión iniciada:', data.user.email);
      navigate('/dashboard'); 

    } catch (error) {
      console.error('Error de login:', error.message);
      // Mensajes de error amigables
      if (error.message === 'Invalid login credentials') {
        setErrorMsg('Correo o contraseña incorrectos.');
      } else {
        setErrorMsg('Ocurrió un error. Verifica tu conexión.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-apple-bg bg-noise flex flex-col justify-center py-12 px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-apple-bgSecondary border border-apple-border rounded-[22px] flex items-center justify-center shadow-[0_0_40px_rgba(41,151,255,0.1)] group transition-apple hover:border-apple-accent/50">
            <Fingerprint size={40} className="text-apple-accent group-hover:scale-110 transition-transform" />
          </div>
        </div>
        <h2 className="text-3xl font-semibold tracking-tight text-apple-text">
          NEXUS DOC AI
        </h2>
        <p className="mt-2 text-sm text-apple-textSecondary flex items-center justify-center gap-2">
          <ShieldCheck size={14} /> Acceso Seguro · UMG Jutiapa
        </p>
      </div>

      <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md">
        <Card className="bg-apple-bgSecondary/40 backdrop-blur-2xl border-apple-border/50 py-10 px-8 shadow-2xl">
          
          {/* Alerta de Error UI */}
          {errorMsg && (
            <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm text-center font-medium">
              {errorMsg}
            </div>
          )}

          <form className="space-y-6" onSubmit={handleLogin}>
            <div>
              <label className="block text-xs font-medium text-apple-textSecondary uppercase tracking-widest mb-2">
                Identificador de Usuario
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="estudiante@umg.edu.gt"
                className="w-full px-4 py-3 bg-apple-bg/50 border border-apple-border rounded-apple focus:outline-none focus:ring-1 focus:ring-apple-accent/50 focus:border-apple-accent transition-apple text-apple-text"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-apple-textSecondary uppercase tracking-widest mb-2">
                Clave de Acceso
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3 bg-apple-bg/50 border border-apple-border rounded-apple focus:outline-none focus:ring-1 focus:ring-apple-accent/50 focus:border-apple-accent transition-apple text-apple-text"
              />
            </div>

            <Button 
              type="submit" 
              className="w-full py-4 mt-2 text-lg font-semibold shadow-[0_0_20px_rgba(41,151,255,0.2)]"
              disabled={isLoading}
            >
              {isLoading ? (
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Verificando...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  Entrar al Sistema <ArrowRight size={20} />
                </div>
              )}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-apple-border/30 text-center">
            <span className="text-[10px] text-apple-textSecondary uppercase tracking-tighter">
              Ingeniería de Software · UMG Jutiapa © 2026
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}