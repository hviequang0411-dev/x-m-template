import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { classify, parseCards, seatAfter, XAM_BASELINE_V1, type CardCode } from '@engine'
import { Button } from '@/components/ui/button'
import { Hand } from '@/components/cards/Hand'
import { PlayingCard } from '@/components/cards/PlayingCard'
import { useAuthStore } from '@/features/auth/store'
import { useSelectionStore } from '@/features/game/selectionStore'
import { COMBINATION_LABEL } from '@/features/game/labels'
import { fetchMatch, fetchMyHand, passTurn, playCards, type MatchView, type SeatView } from '@/features/match/api'
import { ApiCallError } from '@/lib/functions'
import { useTopic } from '@/lib/realtime'
import { cn } from '@/lib/utils'

const R = XAM_BASELINE_V1

type Load = { state: 'loading' } | { state: 'error' } | { state: 'gone' } | { state: 'ready'; match: MatchView }

export function GameTablePage() {
  const { matchId = '' } = useParams()
  const userId = useAuthStore((s) => s.session?.user.id)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [hand, setHand] = useState<CardCode[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = useSelectionStore((s) => s.selected)
  const clearSelection = useSelectionStore((s) => s.clear)
  const versionRef = useRef(0)

  /** Server state is replaced wholesale; the hand is re-read on every new version (never broadcast). */
  const fetchState = useCallback(
    () => Promise.all([fetchMatch(matchId), fetchMyHand(matchId)]).catch(() => 'error' as const),
    [matchId],
  )
  const apply = useCallback((result: Awaited<ReturnType<typeof fetchState>>) => {
    if (result === 'error') return setLoad({ state: 'error' })
    const [match, myHand] = result
    if (!match) return setLoad({ state: 'gone' })
    versionRef.current = match.version
    setLoad({ state: 'ready', match })
    setHand(myHand)
  }, [])
  const refresh = useCallback(() => fetchState().then(apply), [fetchState, apply])

  useEffect(() => {
    let cancelled = false
    clearSelection()
    void fetchState().then((result) => {
      if (!cancelled) apply(result)
    })
    return () => {
      cancelled = true
    }
  }, [fetchState, apply, clearSelection])

  useTopic(
    matchId ? `match:${matchId}` : null,
    (event, payload) => {
      if (event === 'state' && typeof payload.version === 'number' && payload.version > versionRef.current) void refresh()
    },
    () => void refresh(),
  )

  const hint = useMemo(() => (selected.length ? classify(parseCards(selected), R) : null), [selected])

  if (load.state === 'loading')
    return (
      <p role="status" className="text-slate-500">
        Đang tải bàn chơi…
      </p>
    )
  if (load.state === 'error')
    return (
      <p role="alert" className="text-red-600">
        Không tải được bàn chơi. Vui lòng tải lại trang.
      </p>
    )
  if (load.state === 'gone')
    return (
      <div className="grid gap-3">
        <p>Không tìm thấy ván này, hoặc bạn không tham gia ván.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link to="/">Về sảnh</Link>
        </Button>
      </div>
    )

  const { match } = load
  const me = match.seats.find((s) => s.userId === userId)
  const finished = match.status !== 'PLAYING'
  const myTurn = !finished && me?.seat === match.currentSeat
  const leading = match.currentTrick === null
  // Opponents in play order after me (CCW).
  const order: SeatView[] = []
  if (me) for (let s = seatAfter(me.seat, R), i = 0; i < 3; s = seatAfter(s, R), i++) order.push(match.seats[s]!)

  async function act(kind: 'play' | 'pass') {
    setPending(true)
    setError(null)
    try {
      if (kind === 'play') await playCards(match.matchId, match.version, selected)
      else await passTurn(match.matchId, match.version)
      clearSelection()
    } catch (e) {
      // VERSION_CONFLICT: someone else moved first. Refetch silently and keep the selection (ARCHITECTURE §6).
      if (!(e instanceof ApiCallError && e.code === 'VERSION_CONFLICT'))
        setError(e instanceof ApiCallError ? e.message : 'Có lỗi xảy ra, vui lòng thử lại')
    } finally {
      await refresh()
      setPending(false)
    }
  }

  const winner = match.winnerSeat !== null ? match.seats[match.winnerSeat] : null

  return (
    <div className="grid gap-4">
      <ol className="grid grid-cols-3 gap-2" aria-label="Đối thủ">
        {order.map((s) => (
          <SeatBadge key={s.seat} seat={s} match={match} />
        ))}
      </ol>

      <section aria-label="Bài trên bàn" className="grid min-h-40 place-items-center rounded-xl bg-felt p-4">
        {match.currentTrick ? (
          <div className="grid justify-items-center gap-2">
            <p className="text-sm text-white/80">
              {match.seats[match.leadSeat]?.displayName} · {COMBINATION_LABEL[match.currentTrick.type]}
            </p>
            <div className="flex flex-wrap justify-center gap-1">
              {parseCards(match.currentTrick.cards).map((c) => (
                <PlayingCard key={c.code} card={c} />
              ))}
            </div>
          </div>
        ) : (
          !finished && (
            <p className="text-center text-white/80">
              Vòng mới · {match.seats[match.currentSeat]?.displayName} đánh trước
            </p>
          )
        )}
      </section>

      {finished && (
        <section aria-label="Kết quả" className="grid gap-3 rounded-xl border border-gold bg-white p-4 text-center">
          <p className="text-xl font-semibold" role="status">
            {winner ? (winner.userId === userId ? 'Bạn thắng ván này! 🏆' : `${winner.displayName} thắng ván này`) : 'Ván đã kết thúc'}
          </p>
          <Button asChild className="mx-auto w-fit">
            <Link to={`/room/${match.roomId}`}>Về phòng</Link>
          </Button>
        </section>
      )}

      {me && !finished && (
        <section aria-label="Bài của bạn" className="grid gap-3">
          <div className="flex items-center justify-between text-sm">
            <span className={cn('font-medium', myTurn && 'text-felt')}>
              {myTurn ? 'Đến lượt bạn' : `Chờ ${match.seats[match.currentSeat]?.displayName}…`}
            </span>
            <span className="text-slate-500">{hand.length} lá</span>
          </div>
          <Hand cards={hand} disabled={pending} />
          <p className="min-h-5 text-sm text-slate-600" aria-live="polite">
            {selected.length === 0
              ? myTurn
                ? leading
                  ? 'Bạn dẫn vòng: đánh bộ bất kỳ'
                  : 'Chọn bộ lớn hơn để chặn, hoặc bỏ lượt'
                : ' '
              : hint
                ? `${COMBINATION_LABEL[hint.type]} (${hint.size} lá)`
                : 'Chưa phải bộ hợp lệ'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!myTurn || pending || !hint} onClick={() => void act('play')}>
              Đánh
            </Button>
            <Button variant="outline" disabled={!myTurn || pending || leading} onClick={() => void act('pass')}>
              Bỏ lượt
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

function SeatBadge({ seat, match }: { seat: SeatView; match: MatchView }) {
  const isTurn = match.status === 'PLAYING' && match.currentSeat === seat.seat
  const passed = match.passedSeats.includes(seat.seat)
  return (
    <li
      aria-current={isTurn ? 'true' : undefined}
      className={cn(
        'rounded-lg border bg-white p-2 text-sm',
        isTurn ? 'border-gold ring-2 ring-gold' : 'border-slate-200',
        passed && 'opacity-60',
      )}
    >
      <p className="truncate font-medium">
        {seat.displayName}
        {match.winnerSeat === seat.seat && ' 🏆'}
      </p>
      <p className="text-slate-600">{seat.cardCount} lá</p>
      <p className="text-xs text-slate-500">
        {[isTurn && 'Đang đánh', passed && 'Đã bỏ', !seat.hasPlayed && 'Chưa đánh'].filter(Boolean).join(' · ') || ' '}
      </p>
    </li>
  )
}
