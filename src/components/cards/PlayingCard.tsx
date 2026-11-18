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

const COURT_BADGE: Partial<Record<Card['rank'], string>> = {
  J: '♞',
  Q: '♛',
  K: '♚',
  A: '✦',
}

/** One face-up card. Interactive (toggle button) when `onToggle` is given, otherwise static. */
export function PlayingCard({ card, selected = false, disabled = false, onToggle, className }: PlayingCardProps) {
  const red = card.suit === 'D' || card.suit === 'H'
  const rank = RANK_LABEL[card.rank]
  const suit = SUIT_SYMBOL[card.suit]
  const court = COURT_BADGE[card.rank]

  const face = (
    <>
      {/* Subtle inner frame */}
      <span
        className={cn(
          'pointer-events-none absolute inset-[3px] rounded-[5px] border',
          selected ? 'border-gold/50' : 'border-card-border/50',
        )}
        aria-hidden
      />
      {/* Top-left corner index */}
      <span className="absolute left-1.5 top-1 flex flex-col items-center leading-none" aria-hidden>
        <span className="text-[13px] font-extrabold tracking-tighter sm:text-base">{rank}</span>
        <span className="text-[11px] sm:text-xs">{suit}</span>
      </span>
      {/* Center pip / emblem */}
      <span className="absolute inset-0 flex flex-col items-center justify-center leading-none" aria-hidden>
        {court && <span className="mb-0.5 text-[10px] opacity-60 sm:text-xs">{court}</span>}
        <span className="text-2xl drop-shadow-[0_1px_1px_rgba(0,0,0,0.08)] sm:text-3xl">{suit}</span>
      </span>
      {/* Bottom-right inverted index (visible on sm and up, subtle on mobile) */}
      <span
        className=" hidden rotate-180 flex-col items-center leading-none opacity-85 sm:absolute sm:bottom-1 sm:right-1.5 sm:flex"
        aria-hidden
      >
        <span className="text-xs font-bold tracking-tighter">{rank}</span>
        <span className="text-[10px]">{suit}</span>
      </span>
    </>
  )

  const base = cn(
    'playing-card-surface relative h-[4.5rem] w-[3.1rem] shrink-0 select-none rounded-lg border transition-all duration-200 ease-out sm:h-24 sm:w-[4.25rem] lg:h-[6.6rem] lg:w-[4.75rem]',
    red ? 'text-suit-red' : 'text-suit-black',
    selected ? 'playing-card-selected border-gold' : 'border-card-border',
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
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-felt-dark',
        selected && '-translate-y-3.5 sm:-translate-y-4',
        !disabled && !selected && 'hover:-translate-y-1.5 hover:border-gold-light',
        selected && !disabled && 'hover:-translate-y-4',
        disabled && 'cursor-not-allowed opacity-70',
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

/** Ornamental miniature face-down card stack representing an opponent's remaining hand. */
export function CardBackStack({ count }: { count: number }) {
  const layers = Math.min(Math.max(count, 0), 4)
  if (layers === 0) {
    return (
      <span
        aria-hidden
        className="inline-flex h-7 w-5 items-center justify-center rounded border border-dashed border-gold/30 text-[10px] text-gold-light/50"
      >
        0
      </span>
    )
  }
  return (
    <span className="relative inline-flex h-8 items-center" style={{ width: `${18 + (layers - 1) * 4}px` }} aria-hidden>
      {Array.from({ length: layers }, (_, i) => (
        <span
          key={i}
          style={{ left: `${i * 4}px`, top: `${(layers - 1 - i) * 1}px` }}
          className="card-back-pattern absolute h-7 w-5 rounded-[4px] border border-gold/60"
        />
      ))}
    </span>
  )
}
