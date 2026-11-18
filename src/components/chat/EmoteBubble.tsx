import { emoteOf } from '@/features/chat/emotes'
import { cn } from '@/lib/utils'

interface EmoteBubbleProps {
  code: string
  /** Sender's name, for screen readers. */
  name: string
  className?: string
}

/** A short-lived speech bubble with an emote, placed next to a seat (positioned by the parent). */
export function EmoteBubble({ code, name, className }: EmoteBubbleProps) {
  const emote = emoteOf(code)
  if (!emote) return null
  return (
    <span
      role="status"
      aria-label={`${name}: ${emote.label}`}
      className={cn(
        'animate-emote-pop pointer-events-none absolute z-30 inline-flex items-center gap-1 rounded-2xl border-2 border-gold bg-ivory px-2.5 py-1 font-bold whitespace-nowrap text-wood-dark shadow-lg',
        className,
      )}
    >
      <span aria-hidden className="text-lg leading-none">
        {emote.emoji}
      </span>
      <span aria-hidden className="text-xs">
        {emote.label}
      </span>
    </span>
  )
}
