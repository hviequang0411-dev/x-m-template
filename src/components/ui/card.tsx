import * as React from 'react'
import { cn } from '@/lib/utils'

type DivProps = React.HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-card-border/90 bg-ivory shadow-[0_8px_24px_-8px_rgba(35,18,9,0.12)] ring-1 ring-white/80',
        className,
      )}
      {...props}
    />
  )
}
export function CardHeader({ className, ...props }: DivProps) {
  return <div className={cn('flex flex-col gap-1.5 p-5 sm:p-6', className)} {...props} />
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('font-display text-xl font-bold tracking-tight text-slate-900', className)} {...props} />
}
export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm leading-relaxed text-slate-600', className)} {...props} />
}
export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn('p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
}
export function CardFooter({ className, ...props }: DivProps) {
  return <div className={cn('flex items-center p-5 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
}
