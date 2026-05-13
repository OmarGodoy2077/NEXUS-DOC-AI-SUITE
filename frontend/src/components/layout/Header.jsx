import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, Bell, User, LogOut, ChevronDown, CheckCircle2, Info, Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { useApp } from '../../context/AppContext';

const STATIC_NOTIFICATIONS = [
  { id: 1, title: 'Sistema Conectado', message: 'Conexión a PostgreSQL establecida.', time: 'Sistema', type: 'info', unread: false },
  { id: 2, title: 'IA Activa', message: 'Procesamiento OCR con Llama 3.2 disponible.', time: 'Sistema', type: 'success', unread: false },
];

export function Header({ onMenuClick }) {
  const { user, signOut } = useApp();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotifOpen,   setIsNotifOpen]   = useState(false);
  const [notifications, setNotifications] = useState(STATIC_NOTIFICATIONS);
  const profileRef = useRef(null);
  const notifRef   = useRef(null);
  const navigate   = useNavigate();

  useEffect(() => {
    function handleClickOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setIsProfileOpen(false);
      if (notifRef.current   && !notifRef.current.contains(e.target))   setIsNotifOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    setIsProfileOpen(false);
    await signOut();
    navigate('/');
  };

  const markAllAsRead = () => setNotifications(n => n.map(x => ({ ...x, unread: false })));
  const unreadCount = notifications.filter(n => n.unread).length;

  // Derive display name from email
  const email = user?.email || '';
  const displayName = email.includes('@')
    ? email.split('@')[0].split('.')[0].replace(/^\w/, c => c.toUpperCase())
    : 'Admin';

  return (
    <header className="h-16 bg-apple-bgSecondary/60 backdrop-blur-md border-b border-apple-border/50 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onMenuClick} className="md:hidden">
          <Menu size={20} />
        </Button>
        <h1 className="text-lg font-semibold md:hidden tracking-tight">NEXUS</h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <Button
            variant="ghost" size="icon"
            className="relative text-apple-textSecondary hover:text-apple-text"
            onClick={() => { setIsNotifOpen(v => !v); setIsProfileOpen(false); }}
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-apple-error rounded-full border-2 border-apple-bg" />
            )}
          </Button>

          {isNotifOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-apple-bg/95 backdrop-blur-2xl border border-apple-border rounded-apple shadow-[0_8px_30px_rgb(0,0,0,0.5)] py-2 z-50 origin-top-right overflow-hidden">
              <div className="px-4 py-2 border-b border-apple-border/50 flex items-center justify-between">
                <p className="text-sm font-semibold text-apple-text">Notificaciones</p>
                {unreadCount > 0 && (
                  <button onClick={markAllAsRead} className="text-xs text-apple-accent hover:text-apple-accentHover flex items-center gap-1">
                    <Check size={14} /> Marcar leídas
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
                {notifications.map(notif => (
                  <div key={notif.id} className={`px-4 py-3 border-b border-apple-border/30 last:border-0 flex gap-3 ${notif.unread ? 'bg-apple-accent/5' : ''}`}>
                    <div className="mt-0.5 shrink-0">
                      {notif.type === 'success' && <CheckCircle2 size={16} className="text-apple-success" />}
                      {notif.type === 'info'    && <Info size={16} className="text-apple-accent" />}
                    </div>
                    <div>
                      <p className={`text-sm ${notif.unread ? 'font-semibold text-apple-text' : 'font-medium text-apple-textSecondary'}`}>{notif.title}</p>
                      <p className="text-xs text-apple-textSecondary mt-0.5 leading-relaxed">{notif.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-apple-border mx-2" />

        {/* Profile */}
        <div className="relative" ref={profileRef}>
          <Button
            variant="ghost"
            className="flex items-center gap-2 pl-2 pr-3"
            onClick={() => { setIsProfileOpen(v => !v); setIsNotifOpen(false); }}
          >
            <div className="w-8 h-8 rounded-full bg-apple-bg border border-apple-border flex items-center justify-center text-apple-accent">
              <User size={16} />
            </div>
            <span className="text-sm font-medium hidden sm:block">{displayName}</span>
            <ChevronDown size={14} className={`text-apple-textSecondary hidden sm:block transition-transform ${isProfileOpen ? 'rotate-180' : ''}`} />
          </Button>

          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-apple-bg/95 backdrop-blur-2xl border border-apple-border rounded-apple shadow-[0_8px_30px_rgb(0,0,0,0.5)] py-1 z-50 origin-top-right">
              <div className="px-4 py-3 border-b border-apple-border/50 mb-1">
                <p className="text-sm font-semibold text-apple-text">NEXUS DOC AI</p>
                <p className="text-xs text-apple-textSecondary mt-0.5 truncate">{email || 'Invitado'}</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 text-sm text-apple-error hover:bg-apple-error/10 flex items-center gap-3 transition-colors"
              >
                <LogOut size={16} /> Cerrar Sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
