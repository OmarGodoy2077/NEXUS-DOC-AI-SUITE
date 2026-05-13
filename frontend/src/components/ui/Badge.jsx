import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const variants = {
  default: "bg-apple-bgSecondary text-apple-textSecondary",
  success: "bg-apple-success/10 text-apple-success",
  warning: "bg-apple-warning/10 text-apple-warning",
  error: "bg-apple-error/10 text-apple-error",
  outline: "bg-transparent border border-apple-border text-apple-textSecondary"
};

export function Badge({ variant = 'default', className, children }) {
  return (
    <span
      className={twMerge(
        clsx(
          "px-2.5 py-0.5 rounded-full text-xs font-medium inline-flex items-center",
          variants[variant],
          className
        )
      )}
    >
      {children}
    </span>
  );
}