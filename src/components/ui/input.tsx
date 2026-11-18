import * as React from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'flex h-10 w-full rounded-lg border border-card-border bg-white px-3.5 py-2 text-sm text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 focus-visible:border-gold-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45 disabled:opacity-50 aria-invalid:border-suit-red',
        className,
      )}
      {...props}
    />
  )
}
