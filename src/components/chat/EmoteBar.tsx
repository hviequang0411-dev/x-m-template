import { EMOTES, type EmoteCode } from '@/features/chat/emotes'
import { cn } from '@/lib/utils'

interface EmoteBarProps {
  onPick: (code: EmoteCode) => void
  disabled?: boolean
  tone?: 'light' | 'dark'
  className?: string
}

/** One button per emote. */
export function EmoteBar({ onPick, disabled, tone = 'light', className }: EmoteBarProps) {
  return (
    <div role="group" aria-label="Biểu cảm" className={cn('flex flex-wrap gap-1', className)}>
      {EMOTES.map((e) => (
        <button
          key={e.code}
          type="button"
          disabled={disabled}
          title={e.label}
          aria-label={`Gửi biểu cảm: ${e.label}`}
          onClick={() => onPick(e.code)}
          className={cn(
            'inline-flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-full border px-1.5 text-base leading-none transition-all hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none active:scale-95 disabled:cursor-not-allowed disabled:opacity-50',
            tone === 'dark'
              ? 'border-gold/30 bg-white/8 hover:border-gold hover:bg-white/15'
              : 'border-card-border bg-ivory hover:border-gold hover:bg-amber-50',
          )}
        >
          <span aria-hidden>{e.emoji}</span>
        </button>
      ))}
    </div>
  )
}
