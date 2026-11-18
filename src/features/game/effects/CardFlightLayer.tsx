import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react'
import { CardBack } from '@/components/cards/PlayingCard'

interface Vec2 {
  x: number
  y: number
}

interface CardFlightLayerProps {
  dealing: boolean
  step: number
  totalSteps: number
  seatKeys: readonly string[]
  tableRef: RefObject<HTMLDivElement | null>
  targetRefs: RefObject<Map<string, HTMLElement | null>>
}

const FALLBACK_ME: Vec2 = { x: 0, y: 210 }
const FALLBACK_TOP: Vec2 = { x: 0, y: -195 }
const FALLBACK_LEFT: Vec2 = { x: -240, y: -85 }
const FALLBACK_RIGHT: Vec2 = { x: 240, y: -85 }

function fallbackForSeat(key: string, idx: number, total: number): Vec2 {
  if (key === 'me') return FALLBACK_ME
  if (total <= 1) return FALLBACK_TOP
  if (total === 2) return idx === 0 ? FALLBACK_RIGHT : FALLBACK_LEFT
  if (idx === 0) return FALLBACK_RIGHT
  if (idx === 1) return FALLBACK_TOP
  return FALLBACK_LEFT
}

/**
 * Purely decorative aria-hidden overlay displaying a center deck and flying cards dealt
 * round-robin toward each seat's bounding box during the opening deal sequence.
 */
export function CardFlightLayer({
  dealing,
  step,
  totalSteps,
  seatKeys,
  tableRef,
  targetRefs,
}: CardFlightLayerProps) {
  const [vectors, setVectors] = useState<Record<string, Vec2>>({})

  useEffect(() => {
    if (!dealing) return
    const raf = window.requestAnimationFrame(() => {
      const container = tableRef.current
      if (!container) return
      const cRect = container.getBoundingClientRect()
      const originX = cRect.left + cRect.width / 2
      const originY = cRect.top + cRect.height * 0.44

      const next: Record<string, Vec2> = {}
      const oppKeys = seatKeys.filter((k) => k !== 'me')
      for (const key of seatKeys) {
        const el = targetRefs.current.get(key)
        if (el) {
          const r = el.getBoundingClientRect()
          next[key] = {
            x: Math.round(r.left + r.width / 2 - originX),
            y: Math.round(r.top + r.height / 2 - originY),
          }
        } else {
          next[key] = fallbackForSeat(key, oppKeys.indexOf(key), oppKeys.length)
        }
      }
      setVectors(next)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [dealing, seatKeys, tableRef, targetRefs])

  const activeCards = useMemo(() => {
    if (!dealing || step <= 0 || seatKeys.length === 0) return []
    const windowSize = 7
    const start = Math.max(0, step - windowSize)
    const items: { id: number; toX: number; toY: number; rot: number; isMe: boolean }[] = []
    for (let i = start; i < step; i++) {
      const seatIndex = i % seatKeys.length
      const roundIdx = Math.floor(i / seatKeys.length)
      const key = seatKeys[seatIndex]!
      const isMe = key === 'me'
      const base = vectors[key] ?? { x: 0, y: isMe ? 200 : -160 }
      const meSpread = isMe ? (roundIdx - 4.5) * 20 : ((roundIdx % 3) - 1) * 8
      items.push({
        id: i,
        toX: base.x + meSpread,
        toY: base.y,
        rot: isMe ? (roundIdx - 4.5) * 1.4 : ((i % 5) - 2) * 5,
        isMe,
      })
    }
    return items
  }, [dealing, step, seatKeys, vectors])

  if (!dealing || seatKeys.length === 0) return null

  const remainingLayers = Math.max(1, Math.min(6, Math.ceil(((totalSteps - step) / Math.max(totalSteps, 1)) * 6)))

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden"
    >
      {/* Center stacked deck at 44% height */}
      <div className="relative -mt-12 flex flex-col items-center">
        <div className="relative h-[4.5rem] w-[3.1rem] sm:h-20 sm:w-14">
          {Array.from({ length: remainingLayers }, (_, idx) => (
            <CardBack
              key={idx}
              style={{
                transform: `translate3d(${idx * 1.5}px, ${-idx * 1.5}px, 0)`,
              }}
              className="absolute inset-0 shadow-lg"
            />
          ))}

          {/* Flying cards originating from top of deck */}
          {activeCards.map((c) => (
            <div
              key={c.id}
              style={
                {
                  '--deal-x': `${c.toX}px`,
                  '--deal-y': `${c.toY}px`,
                  '--deal-rot': `${c.rot}deg`,
                } as CSSProperties
              }
              className={c.isMe ? 'animate-deal-flight-me absolute inset-0' : 'animate-deal-flight absolute inset-0'}
            >
              {c.isMe ? (
                <div className="playing-card-surface flex h-full w-full items-center justify-center rounded-lg border border-gold shadow-xl">
                  <span className="text-base font-bold text-gold-dark">♠</span>
                </div>
              ) : (
                <CardBack className="h-full w-full shadow-xl" />
              )}
            </div>
          ))}
        </div>

        <span className="mt-4 rounded-full border border-gold/45 bg-black/65 px-3 py-0.5 text-[11px] font-semibold text-gold-light shadow-md backdrop-blur-md">
          Đang chia bài… (bấm để bỏ qua)
        </span>
      </div>
    </div>
  )
}
