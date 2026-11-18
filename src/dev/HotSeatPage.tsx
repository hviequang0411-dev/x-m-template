import { useMemo, useState } from 'react'
import {
  applyAction,
  chooseFirstLeader,
  classify,
  createMatchState,
  cryptoRandomInt,
  parseCards,
  shuffleAndDeal,
  XAM_BASELINE_V2,
  type GameAction,
  type GameEvent,
  type MatchState,
} from '@engine'
import { Button } from '@/components/ui/button'
import { Hand } from '@/components/cards/Hand'
import { PlayingCard } from '@/components/cards/PlayingCard'
import { useSelectionStore } from '@/features/game/selectionStore'
import { COMBINATION_LABEL, MOVE_ERROR_MESSAGE } from '@/features/game/labels'
import { cn } from '@/lib/utils'

const R = XAM_BASELINE_V2

function newMatch(previousWinner: number | null = null): MatchState {
  const deal = shuffleAndDeal({ players: 4, handSize: R.handSize }, cryptoRandomInt)
  return createMatchState(
    deal.hands.map((h) => h.map((c) => c.code)),
    chooseFirstLeader({ players: 4 }, cryptoRandomInt, previousWinner),
  )
}

function describeEvent(e: GameEvent): string {
  switch (e.type) {
    case 'PLAYED':
      return `Ghế ${e.seat} đánh ${COMBINATION_LABEL[e.combination.type]}: ${e.combination.cards.join(' ')}`
    case 'PASSED':
      return `Ghế ${e.seat} bỏ lượt`
    case 'SAM_DECLARED':
      return `🔥 Ghế ${e.seat} đã Báo Xâm! Đi trước`
    case 'ROUND_RESET':
      return `Hết vòng, ghế ${e.leadSeat} dẫn vòng mới`
    case 'MATCH_FINISHED':
      if (e.endReason === 'THOI_2_CUOI') return `Ghế ${e.foulSeat} đánh 2 cuối nên bị xử thua (Thối 2)! Ghế ${e.winnerSeat} thắng!`
      if (e.endReason === 'SAM_CAUGHT') return `Ghế ${e.winnerSeat} chặn đứng Báo Xâm của ghế ${e.foulSeat}! Ghế ${e.winnerSeat} thắng!`
      return `Ghế ${e.winnerSeat} thắng!`
  }
}

/**
 * Dev-only "hot-seat" table (T4.4): four seats on one screen, driven directly by the engine reducer.
 * Not in production builds. The real game validates on the server.
 */
export function HotSeatPage({ initialState }: { initialState?: MatchState }) {
  const [state, setState] = useState<MatchState>(() => initialState ?? newMatch())
  const [error, setError] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const selected = useSelectionStore((s) => s.selected)
  const clear = useSelectionStore((s) => s.clear)

  const seat = state.currentSeat
  const finished = state.status === 'FINISHED'
  const canDeclareSam = !finished && state.samSeat == null && state.seats.every((s) => !s.hasPlayed)
  const hint = useMemo(() => (selected.length ? classify(parseCards(selected), R) : null), [selected])

  function act(action: GameAction) {
    const r = applyAction(state, action, R)
    if (!r.ok) {
      setError(MOVE_ERROR_MESSAGE[r.error])
      return
    }
    setError(null)
    clear()
    setState(r.value.nextState)
    setLog((l) => [...r.value.events.map(describeEvent).reverse(), ...l].slice(0, 30))
  }

  function restart() {
    clear()
    setError(null)
    setLog([])
    setState(newMatch(state.winnerSeat))
  }

  return (
    <main className="mx-auto grid max-w-4xl gap-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold">Bàn chơi thử 4 ghế (dev)</h1>
        <Button variant="gold" size="sm" onClick={restart}>
          {finished ? 'Tiếp tục ván mới' : 'Ván mới'}
        </Button>
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Các ghế">
        {state.seats.map((s, i) => {
          const passed = state.passedSeats.includes(i)
          const isTurn = !finished && i === seat
          const isSam = state.samSeat === i
          return (
            <li
              key={i}
              aria-current={isTurn ? 'true' : undefined}
              className={cn(
                'rounded-xl border bg-ivory p-3 text-sm',
                isTurn ? 'border-gold ring-2 ring-gold' : 'border-card-border',
                passed && 'opacity-60',
              )}
            >
              <p className="font-semibold">
                Ghế {i}
                {state.winnerSeat === i && ' 🏆'}
                {isSam && <span className="ml-1.5 rounded bg-suit-red px-1.5 py-0.5 text-xs text-gold-light">🔥 Báo Xâm</span>}
              </p>
              <p className="text-slate-600">{s.hand.length} lá</p>
              <p className="text-xs text-slate-500">
                {[
                  isTurn && 'Đến lượt',
                  state.leadSeat === i && !finished && 'Giữ vòng',
                  passed && 'Đã bỏ',
                  !s.hasPlayed && 'Chưa đánh',
                ]
                  .filter(Boolean)
                  .join(' · ') || '\u00A0'}
              </p>
            </li>
          )
        })}
      </ol>

      <section aria-label="Bài trên bàn" className="casino-table-surface grid min-h-36 place-items-center rounded-2xl p-4">
        {state.currentTrick ? (
          <div className="grid justify-items-center gap-2">
            <p className="text-sm text-white/80">
              Ghế {state.leadSeat} · {COMBINATION_LABEL[state.currentTrick.type]}
            </p>
            <div className="flex flex-wrap justify-center gap-1">
              {parseCards(state.currentTrick.cards).map((c) => (
                <PlayingCard key={c.code} card={c} />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-white/80">
            {finished ? `Ghế ${state.winnerSeat} thắng ván này` : `Vòng mới: ghế ${seat} đánh bộ bất kỳ`}
          </p>
        )}
      </section>

      {!finished && (
        <section aria-label={`Bài của ghế ${seat}`} className="grid gap-3">
          <p className="text-sm font-medium">Lượt của ghế {seat}</p>
          <Hand cards={state.seats[seat]!.hand} />
          <p className="min-h-5 text-sm text-slate-600" aria-live="polite">
            {selected.length === 0
              ? 'Chọn lá để đánh'
              : hint
                ? `${COMBINATION_LABEL[hint.type]} (${hint.size} lá)`
                : 'Chưa phải bộ hợp lệ'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={selected.length === 0} onClick={() => act({ type: 'PLAY', seat, cards: selected })}>
              Đánh
            </Button>
            <Button variant="outline" onClick={() => act({ type: 'PASS', seat })}>
              Bỏ lượt
            </Button>
            {canDeclareSam && (
              <button
                type="button"
                onClick={() => act({ type: 'DECLARE_SAM', seat })}
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-gold bg-gradient-to-b from-suit-red to-suit-red-dark px-4 py-2 text-sm font-extrabold text-gold-light shadow-sm hover:brightness-110"
              >
                🔥 Báo Xâm
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </section>
      )}

      <section aria-label="Nhật ký" className="text-sm text-slate-600">
        <h2 className="mb-1 font-medium text-slate-800">Nhật ký</h2>
        <ul className="grid gap-0.5">
          {log.map((line, i) => (
            <li key={log.length - i}>{line}</li>
          ))}
        </ul>
      </section>
    </main>
  )
}
