import type { Card } from '@engine'
import { cn } from '@/lib/utils'
import { RANK_LABEL, SUIT_SYMBOL, cardLabel } from './cardLabels'

interface PlayingCardProps {
  card: Card
  selected?: boolean
  disabled?: boolean
  onToggle?: (card: Card) => void
  className?: string
}

/** One face-up card. Interactive (toggle button) when `onToggle` is given, otherwise static. */
export function PlayingCard({ card, selected = false, disabled = false, onToggle, className }: PlayingCardProps) {
  const red = card.suit === 'D' || card.suit === 'H'
  const rank = RANK_LABEL[card.rank]
  const suit = SUIT_SYMBOL[card.suit]
  const face = (
    <>
      <span className="absolute left-1 top-0.5 flex flex-col items-center leading-none" aria-hidden>
        <span className="text-sm font-bold sm:text-base">{rank}</span>
        <span className="text-xs sm:text-sm">{suit}</span>
      </span>
      <span className="absolute inset-0 flex items-center justify-center text-2xl sm:text-3xl" aria-hidden>
        {suit}
      </span>
    </>
  )
  const base = cn(
    'relative h-[4.5rem] w-12 shrink-0 select-none rounded-md border bg-white shadow-sm sm:h-24 sm:w-16',
    red ? 'text-red-600' : 'text-slate-900',
    selected ? 'border-gold ring-2 ring-gold' : 'border-slate-300',
    className,
  )

  if (!onToggle)
    return (
      <div className={base} role="img" aria-label={cardLabel(card)}>
        {face}
      </div>
    )

  return (
    <button
      type="button"
      className={cn(
        base,
        'transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500',
        selected && '-translate-y-3',
        !disabled && 'hover:-translate-y-1',
        selected && !disabled && 'hover:-translate-y-3',
        disabled && 'cursor-not-allowed opacity-60',
      )}
      aria-label={cardLabel(card)}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onToggle(card)}
      data-card={card.code}
    >
      {face}
    </button>
  )
}
