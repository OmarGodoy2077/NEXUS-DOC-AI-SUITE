import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, FileText, CreditCard, Link2,
  FileSpreadsheet, UploadCloud, Settings, X
} from 'lucide-react';
import { clsx } from 'clsx';

const NAV = [
  { section: 'PRINCIPAL' },
  { path: '/dashboard',      icon: LayoutDashboard,  label: 'Dashboard' },

  { section: 'FINANZAS' },
  { path: '/facturas',       icon: FileText,          label: 'Facturas DTE-FEL' },
  { path: '/metodos-pago',   icon: CreditCard,        label: 'Métodos de Pago' },
  { path: '/conciliacion',   icon: Link2,             label: 'Conciliación' },

  { section: 'HERRAMIENTAS' },
  { path: '/importar-excel', icon: FileSpreadsheet,   label: 'Importar Excel SAT' },
  { path: '/upload',         icon: UploadCloud,       label: 'OCR Documentos' },

  { section: 'SISTEMA' },
  { path: '/admin',          icon: Settings,          label: 'Administración' },
];

export function Sidebar({ isOpen, onClose }) {
  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={onClose} />
      )}

      <aside className={clsx(
        'fixed top-0 left-0 z-50 h-screen w-[220px] bg-apple-bg border-r border-apple-border flex flex-col transform transition-transform duration-300 ease-in-out md:translate-x-0 md:static',
        isOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        <div className="h-14 flex items-center justify-between px-5 border-b border-apple-border shrink-0">
          <div>
            <span className="font-semibold text-sm tracking-tight text-apple-text">NEXUS DOC AI</span>
            <span className="ml-2 text-[10px] text-apple-textSecondary bg-apple-bgSecondary px-1.5 py-0.5 rounded-full border border-apple-border">v2.0</span>
          </div>
          <button onClick={onClose} className="md:hidden p-1 text-apple-textSecondary hover:text-apple-text">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 py-4 flex flex-col gap-0.5 px-2 overflow-y-auto">
          {NAV.map((item, i) => {
            if (item.section) {
              return (
                <p key={i} className="text-[10px] font-semibold text-apple-textSecondary tracking-widest uppercase px-3 py-2 mt-2">
                  {item.section}
                </p>
              );
            }
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={({ isActive }) => clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-apple',
                  isActive
                    ? 'bg-apple-accent/10 text-apple-accent'
                    : 'text-apple-textSecondary hover:bg-apple-bgSecondary hover:text-apple-text'
                )}
              >
                <item.icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="px-4 py-3 border-t border-apple-border shrink-0">
          <p className="text-[10px] text-apple-textSecondary">Sistema Financiero GTQ · SAT Guatemala</p>
        </div>
      </aside>
    </>
  );
}
