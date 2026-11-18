import { useEffect, useMemo, type CSSProperties } from 'react'
import { parseCards, sortCards, type CardCode } from '@engine'
import { useSelectionStore } from '@/features/game/selectionStore'
import { playSound } from '@/lib/sound'
import { cn } from '@/lib/utils'
import { PlayingCard } from './PlayingCard'

interface HandProps {
  /** The player's own cards as stored on the server. Order doesn't matter; display is sorted by rank. */
  cards: readonly CardCode[]
  /** e.g. while it isn't your turn or a request is pending. */
  disabled?: boolean
}

export function Hand({ cards, disabled = false }: HandProps) {
  const sorted = useMemo(() => sortCards(parseCards(cards)), [cards])
  const selected = useSelectionStore((s) => s.selected)
  const toggle = useSelectionStore((s) => s.toggle)
  const keepOnly = useSelectionStore((s) => s.keepOnly)

  useEffect(() => {
    keepOnly(cards)
  }, [cards, keepOnly])

  if (sorted.length === 0)
    return <p className="py-3 text-center text-sm font-medium text-gold-light/85">Hết bài</p>

  const count = sorted.length
  const mid = (count - 1) / 2

  return (
    <div
      role="group"
      aria-label={`Bài của bạn (${sorted.length} lá)`}
      className="flex max-w-full items-end justify-center px-1 pb-2 pt-5 sm:pt-6"
    >
      {sorted.map((card, i) => {
        const isSelected = selected.includes(card.code)
        const norm = mid > 0 ? (i - mid) / mid : 0
        const fanStyle = {
          '--fan-rot': `${(norm * 5.5).toFixed(2)}deg`,
          '--fan-y': `${Math.round(norm * norm * 10)}px`,
        } as CSSProperties

        return (
          <span
            key={card.code}
            style={fanStyle}
            className={cn(
              'hand-fan-slot inline-flex transition-transform duration-200',
              i > 0 && '-ml-[1.25rem] sm:-ml-5 lg:-ml-3.5',
            )}
          >
            <PlayingCard
              card={card}
              selected={isSelected}
              disabled={disabled}
              className="[transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)]"
              onToggle={(c) => {
                playSound('select')
                toggle(c.code)
              }}
            />
          </span>
        )
      })}
    </div>
  )
}
