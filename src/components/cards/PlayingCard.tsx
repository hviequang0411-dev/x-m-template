import type { CSSProperties } from 'react'
import type { Card } from '@engine'
import { cn } from '@/lib/utils'
import { RANK_LABEL, SUIT_SYMBOL, cardLabel } from './cardLabels'

interface PlayingCardProps {
  card: Card
  selected?: boolean
  disabled?: boolean
  onToggle?: (card: Card) => void
  className?: string
  style?: CSSProperties
}

/** Crisp SVG crest for Royal Court cards (J, Q, K) & Ace. */
function CourtSvg({ rank, red }: { rank: Card['rank']; red: boolean }) {
  const accent = red ? '#c42026' : '#161e29'
  const gold = '#d4a017'
  if (rank === 'J') {
    return (
      <svg viewBox="0 0 36 36" className="size-7 sm:size-9 land:size-6" aria-hidden>
        <circle cx="18" cy="18" r="16" fill="none" stroke={gold} strokeWidth="1.2" strokeOpacity="0.65" />
        {/* Knight / Jack helm & plume */}
        <path d="M12 24 C12 16, 24 16, 24 24 Z" fill={accent} fillOpacity="0.14" stroke={accent} strokeWidth="1.5" />
        <path d="M14 16 L18 8 L23 13 L20 16" fill={gold} stroke={accent} strokeWidth="1.2" strokeLinejoin="round" />
        <circle cx="18" cy="20" r="2.2" fill={gold} />
      </svg>
    )
  }
  if (rank === 'Q') {
    return (
      <svg viewBox="0 0 36 36" className="size-7 sm:size-9 land:size-6" aria-hidden>
        <circle cx="18" cy="18" r="16" fill="none" stroke={gold} strokeWidth="1.2" strokeOpacity="0.65" />
        {/* Queen tiara & gem */}
        <path
          d="M9 24 L11 13 L15 18 L18 10 L21 18 L25 13 L27 24 Z"
          fill={gold}
          fillOpacity="0.35"
          stroke={accent}
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="18" cy="20.5" r="2" fill={accent} />
        <circle cx="11" cy="12" r="1.4" fill={gold} />
        <circle cx="18" cy="9" r="1.6" fill={gold} />
        <circle cx="25" cy="12" r="1.4" fill={gold} />
      </svg>
    )
  }
  if (rank === 'K') {
    return (
      <svg viewBox="0 0 36 36" className="size-7 sm:size-9 land:size-6" aria-hidden>
        <circle cx="18" cy="18" r="16" fill={gold} fillOpacity="0.1" stroke={gold} strokeWidth="1.4" />
        {/* King Royal Crown */}
        <path
          d="M8 25 L10 13 L15 18 L18 11 L21 18 L26 13 L28 25 Z"
          fill={gold}
          fillOpacity="0.55"
          stroke={accent}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <rect x="9" y="25" width="18" height="3" rx="1" fill={accent} />
        <path d="M18 7 V11 M16 9 H20" stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  return null
}

/** One face-up card. Interactive (toggle button) when `onToggle` is given, otherwise static. */
export function PlayingCard({
  card,
  selected = false,
  disabled = false,
  onToggle,
  className,
  style,
}: PlayingCardProps) {
  const red = card.suit === 'D' || card.suit === 'H'
  const rank = RANK_LABEL[card.rank]
  const suit = SUIT_SYMBOL[card.suit]
  const isCourt = card.rank === 'J' || card.rank === 'Q' || card.rank === 'K'
  const isAce = card.rank === 'A'
  const isTwo = card.rank === '2'

  const face = (
    <>
      {/* Subtle royal inner gold-tinted frame */}
      <span
        className={cn(
          'pointer-events-none absolute inset-[3px] rounded-[6px] border transition-colors',
          selected ? 'border-gold' : isTwo ? 'border-gold/55' : 'border-card-border/65',
        )}
        aria-hidden
      />

      {/* Top-left corner index */}
      <span className="absolute left-1.5 top-1 flex flex-col items-center leading-none" aria-hidden>
        <span className="text-[13px] font-extrabold tracking-tighter sm:text-base lg:text-[17px] land:text-sm">{rank}</span>
        <span className="text-[11px] sm:text-xs">{suit}</span>
      </span>

      {/* Special corner halo for Deuce (2 - strongest single card in Xâm) */}
      {isTwo && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1 hidden size-2 rounded-full bg-gold/80 sm:inline-block"
        />
      )}

      {/* Center pip / Royal Court artwork */}
      <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center leading-none" aria-hidden>
        {isCourt ? (
          <span className="flex flex-col items-center gap-0.5 rounded-md border border-gold/25 bg-cream/65 px-1.5 py-1 land:px-1 land:py-0.5">
            <CourtSvg rank={card.rank} red={red} />
            <span className="text-xs opacity-80 sm:text-sm land:text-xs">{suit}</span>
          </span>
        ) : isAce ? (
          <span className="flex flex-col items-center justify-center">
            <span className="text-3xl drop-shadow-[0_2px_2px_rgba(0,0,0,0.14)] sm:text-4xl lg:text-[2.65rem] land:text-3xl">
              {suit}
            </span>
          </span>
        ) : (
          <span className="text-2xl drop-shadow-[0_1px_1px_rgba(0,0,0,0.08)] sm:text-3xl lg:text-[2.15rem] land:text-2xl">
            {suit}
          </span>
        )}
      </span>

      {/* Bottom-right inverted index (visible on sm and up) */}
      <span
        className="hidden rotate-180 flex-col items-center leading-none opacity-85 sm:absolute sm:bottom-1 sm:right-1.5 sm:flex"
        aria-hidden
      >
        <span className="text-xs font-extrabold tracking-tighter">{rank}</span>
        <span className="text-[10px]">{suit}</span>
      </span>
    </>
  )

  const base = cn(
    'playing-card-surface relative h-[4.5rem] w-[3rem] shrink-0 select-none rounded-lg border transition-all duration-200 ease-out sm:h-24 sm:w-[4.25rem] lg:h-[6.85rem] lg:w-[4.85rem] land:h-[4.6rem] land:w-[3.2rem]',
    red ? 'text-suit-red' : 'text-suit-black',
    selected ? 'playing-card-selected border-gold' : 'border-card-border',
    className,
  )

  if (!onToggle)
    return (
      <div className={base} style={style} role="img" aria-label={cardLabel(card)}>
        {face}
      </div>
    )

  return (
    <button
      type="button"
      style={style}
      className={cn(
        base,
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-felt-dark',
        selected && '-translate-y-3.5 sm:-translate-y-4',
        !disabled && !selected && 'hover:-translate-y-2 hover:border-gold-light',
        selected && !disabled && 'hover:-translate-y-[18px]',
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

/** Single face-down playing card (used for center deck and dealing flights). */
export function CardBack({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        'card-back-pattern relative flex h-[4.25rem] w-[2.95rem] items-center justify-center rounded-lg border border-gold-light/85 sm:h-20 sm:w-14',
        className,
      )}
    >
      <span className="flex size-5 items-center justify-center rounded-full border border-gold-light/55 bg-wood-dark/65 text-[10px] text-gold-light sm:size-6 sm:text-xs">
        ♠
      </span>
    </div>
  )
}

/** Ornamental miniature face-down card stack representing an opponent's remaining hand. */
export function CardBackStack({ count }: { count: number }) {
  const layers = Math.min(Math.max(count, 0), 4)
  if (layers === 0) {
    return (
      <span
        aria-hidden
        className="inline-flex h-7 w-5 items-center justify-center rounded border border-dashed border-gold/35 text-[10px] font-bold text-gold-light/60"
      >
        0
      </span>
    )
  }
  return (
    <span className="relative inline-flex h-8 items-center" style={{ width: `${20 + (layers - 1) * 4}px` }} aria-hidden>
      {Array.from({ length: layers }, (_, i) => (
        <span
          key={i}
          style={{ left: `${i * 4}px`, top: `${(layers - 1 - i) * 1}px` }}
          className="card-back-pattern absolute h-7 w-5 rounded-[4px] border border-gold-light/75"
        />
      ))}
    </span>
  )
}
