import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

export function Modal({ open, onClose, title, children, width = 'max-w-2xl' }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className={twMerge(
        'relative w-full bg-apple-bgSecondary border border-apple-border rounded-apple-lg shadow-apple flex flex-col max-h-[90vh]',
        width
      )}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-apple-border shrink-0">
          <h2 className="text-base font-semibold text-apple-text">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-apple-bg text-apple-textSecondary hover:text-apple-text transition-apple">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-6">{children}</div>
      </div>
    </div>
  );
}
