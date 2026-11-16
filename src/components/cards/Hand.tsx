import { useEffect, useMemo } from 'react'
import { parseCards, sortCards, type CardCode } from '@engine'
import { useSelectionStore } from '@/features/game/selectionStore'
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
    return <p className="text-sm text-slate-500">Hết bài</p>

  return (
    <div role="group" aria-label={`Bài của bạn (${sorted.length} lá)`} className="flex justify-center pt-4">
      {sorted.map((card, i) => (
        <PlayingCard
          key={card.code}
          card={card}
          selected={selected.includes(card.code)}
          disabled={disabled}
          onToggle={(c) => toggle(c.code)}
          className={i === 0 ? undefined : '-ml-5 sm:-ml-6'}
        />
      ))}
    </div>
  )
}
