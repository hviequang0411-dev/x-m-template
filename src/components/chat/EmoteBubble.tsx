import { emoteOf } from '@/features/chat/emotes'
import { cn } from '@/lib/utils'

interface EmoteBubbleProps {
  code: string
  /** Sender's name, for screen readers. */
  name: string
  className?: string
}

/** A short-lived speech bubble with an emote and triangular tail, placed next to a seat. */
export function EmoteBubble({ code, name, className }: EmoteBubbleProps) {
  const emote = emoteOf(code)
  if (!emote) return null
  return (
    <span
      role="status"
      aria-label={`${name}: ${emote.label}`}
      className={cn(
        'animate-emote-pop pointer-events-none absolute z-30 inline-flex items-center gap-1.5 rounded-2xl border-2 border-gold bg-ivory px-3 py-1 font-bold whitespace-nowrap text-wood-dark shadow-[0_8px_18px_rgba(0,0,0,0.45)]',
        className,
      )}
    >
      <span aria-hidden className="text-lg leading-none drop-shadow-2xs">
        {emote.emoji}
      </span>
      <span aria-hidden className="text-xs tracking-tight">
        {emote.label}
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-1.5 left-4 size-2.5 rotate-45 border-r-2 border-b-2 border-gold bg-ivory"
      />
    </span>
  )
}
