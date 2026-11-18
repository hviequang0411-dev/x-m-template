import { useEffect, useMemo } from 'react'
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

  return (
    <div
      role="group"
      aria-label={`Bài của bạn (${sorted.length} lá)`}
      className="flex max-w-full items-end justify-center px-1 pb-1 pt-5"
    >
      {sorted.map((card, i) => {
        const isSelected = selected.includes(card.code)
        return (
          <PlayingCard
            key={card.code}
            card={card}
            selected={isSelected}
            disabled={disabled}
            onToggle={(c) => {
              playSound('select')
              toggle(c.code)
            }}
            className={cn(i === 0 ? undefined : '-ml-[1.35rem] sm:-ml-5')}
          />
        )
      })}
    </div>
  )
}
