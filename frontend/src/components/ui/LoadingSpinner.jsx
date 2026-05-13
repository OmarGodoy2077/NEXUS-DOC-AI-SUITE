import React from 'react';
import { Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

export function LoadingSpinner({ size = 24, text, className }) {
  return (
    <div className={clsx("flex flex-col items-center justify-center gap-2", className)}>
      <Loader2 
        size={size} 
        className="animate-spin text-apple-accent" 
      />
      {text && <span className="text-sm text-apple-textSecondary">{text}</span>}
    </div>
  );
}