import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-felt text-white shadow-sm ring-1 ring-felt-dark/40 hover:bg-felt-light hover:shadow',
        gold:
          'bg-gradient-to-b from-gold-light via-gold to-gold-muted text-wood-dark shadow-sm ring-1 ring-gold-dark/50 hover:brightness-105',
        outline:
          'border border-card-border bg-ivory text-slate-800 shadow-2xs hover:border-gold-muted hover:bg-cream',
        ghost: 'text-slate-700 hover:bg-cream-dark/60',
        destructive: 'bg-suit-red text-white shadow-xs hover:bg-suit-red-dark',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { buttonVariants }
