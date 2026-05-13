import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useApp } from '../../context/AppContext';
import { CheckCircle2, AlertCircle, Bell } from 'lucide-react';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { notification } = useApp();

  const notifConfig = {
    success: { icon: CheckCircle2, cls: 'bg-apple-success/90 border-apple-success/40' },
    error:   { icon: AlertCircle,  cls: 'bg-apple-error/90  border-apple-error/40' },
    info:    { icon: Bell,         cls: 'bg-apple-accent/90 border-apple-accent/40' },
  };
  const cfg = notifConfig[notification?.type] ?? notifConfig.info;

  return (
    <div className="flex h-screen bg-apple-bg bg-noise overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenuClick={() => setSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Toast global de notificaciones */}
      {notification && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-apple border shadow-apple backdrop-blur-sm text-white text-sm font-medium ${cfg.cls}`}>
          <cfg.icon size={16} />
          {notification.message}
        </div>
      )}
    </div>
  );
}