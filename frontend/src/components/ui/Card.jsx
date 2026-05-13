import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function Card({ children, className, ...props }) {
  return (
    <div 
      className={twMerge(
        clsx(
          "bg-apple-bg rounded-apple shadow-apple border border-apple-border p-6",
          className
        )
      )}
      {...props}
    >
      {children}
    </div>
  );
}