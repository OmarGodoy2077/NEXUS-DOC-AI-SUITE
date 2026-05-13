import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const variants = {
  primary: "bg-apple-accent text-white hover:bg-apple-accentHover border border-transparent shadow-sm",
  outline: "bg-transparent text-apple-text border border-apple-border hover:bg-apple-bgSecondary",
  ghost: "bg-transparent text-apple-text hover:bg-apple-bgSecondary border border-transparent"
};

const sizes = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3 text-lg",
  icon: "p-2 flex items-center justify-center"
};

export function Button({ variant = 'primary', size = 'md', className, children, ...props }) {
  return (
    <button
      className={twMerge(
        clsx(
          "inline-flex items-center justify-center rounded-apple font-medium transition-apple",
          "focus:outline-none focus:ring-2 focus:ring-apple-accent/20 disabled:opacity-50 disabled:cursor-not-allowed",
          variants[variant],
          sizes[size],
          className
        )
      )}
      {...props}
    >
      {children}
    </button>
  );
}