import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { classify, parseCards, seatAfter, XAM_BASELINE_V2, type CardCode } from '@engine'
import { Button } from '@/components/ui/button'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { Hand } from '@/components/cards/Hand'
import { PlayingCard } from '@/components/cards/PlayingCard'
import { useAuthStore } from '@/features/auth/store'
import { useSelectionStore } from '@/features/game/selectionStore'
import { useProfileStore } from '@/features/profile/store'
import { COMBINATION_LABEL } from '@/features/game/labels'
import {
  abortMatch,
  claimTimeout,
  fetchMatch,
  fetchMyHand,
  fetchResults,
  passTurn,
  playCards,
  type MatchView,
  type ResultView,
  type SeatView,
} from '@/features/match/api'
import { ApiCallError } from '@/lib/functions'
import { useTopic } from '@/lib/realtime'
import { cn } from '@/lib/utils'

// Only the combination rules are used here (for the "is this a valid play" hint); they are the same
// in v1 and v2. The server is authoritative.
const R = XAM_BASELINE_V2
/** Extra wait after the deadline before claiming, plus random jitter so 4 clients don't all race. */
const CLAIM_GRACE_MS = 1000
const CLAIM_JITTER_MS = 1500

type Load = { state: 'loading' } | { state: 'error' } | { state: 'gone' } | { state: 'ready'; match: MatchView }

/** Whole seconds left until `deadline`, ticking every 250 ms. Null without a deadline. */
function useSecondsLeft(deadline: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [deadline])
  if (!deadline) return null
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000))
}

export function GameTablePage() {
  const { matchId = '' } = useParams()
  const userId = useAuthStore((s) => s.session?.user.id)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [hand, setHand] = useState<CardCode[]>([])
  const [results, setResults] = useState<ResultView[] | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmAbort, setConfirmAbort] = useState(false)
  const selected = useSelectionStore((s) => s.selected)
  const clearSelection = useSelectionStore((s) => s.clear)
  const versionRef = useRef(0)
  const refreshProfile = useProfileStore((s) => s.refresh)

  /** Server state is replaced wholesale; the hand is re-read on every new version (never broadcast). */
  const fetchState = useCallback(
    () =>
      Promise.all([fetchMatch(matchId), fetchMyHand(matchId)])
        .then(async ([match, myHand]) => {
          const res = match && match.status === 'FINISHED' && match.ranked ? await fetchResults(matchId) : null
          return { match, myHand, res }
        })
        .catch(() => 'error' as const),
    [matchId],
  )
  const apply = useCallback((result: Awaited<ReturnType<typeof fetchState>>) => {
    if (result === 'error') return setLoad({ state: 'error' })
    if (!result.match) return setLoad({ state: 'gone' })
    versionRef.current = result.match.version
    setLoad({ state: 'ready', match: result.match })
    setHand(result.myHand)
    setResults(result.res)
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

  const { status: connection } = useTopic(
    matchId ? `match:${matchId}` : null,
    (event, payload) => {
      if (event === 'state' && typeof payload.version === 'number' && payload.version > versionRef.current) void refresh()
    },
    () => void refresh(),
  )

  const match = load.state === 'ready' ? load.match : null
  // Presence on the room topic: who has the game open (display only, R28).
  const { online } = useTopic(match ? `room:${match.roomId}` : null, () => {}, () => {}, { presenceKey: userId })

  // Turn timeout [R27]: once the deadline passes, any open client claims it. The server decides.
  const playing = match?.status === 'PLAYING'
  const deadline = playing ? match.turnDeadline : null
  const version = match?.version
  useEffect(() => {
    if (!deadline || version === undefined) return
    const wait = Date.parse(deadline) - Date.now() + CLAIM_GRACE_MS + Math.random() * CLAIM_JITTER_MS
    const id = setTimeout(() => {
      void claimTimeout(matchId, version)
        .catch(() => {}) // VERSION_CONFLICT / TURN_NOT_EXPIRED: someone else moved or claimed first
        .then(refresh)
    }, Math.max(0, wait))
    return () => clearTimeout(id)
  }, [deadline, version, matchId, refresh])

  // The balance in the header changes when a ranked match ends.
  const finishedNow = match?.status === 'FINISHED'
  useEffect(() => {
    if (finishedNow && userId) void refreshProfile(userId)
  }, [finishedNow, userId, refreshProfile])

  const secondsLeft = useSecondsLeft(deadline)
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
  if (load.state === 'gone' || !match)
    return (
      <div className="grid gap-3">
        <p>Không tìm thấy ván này, hoặc bạn không tham gia ván.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link to="/">Về sảnh</Link>
        </Button>
      </div>
    )

  const me = match.seats.find((s) => s.userId === userId)
  const finished = match.status !== 'PLAYING'
  const myTurn = !finished && me?.seat === match.currentSeat
  const leading = match.currentTrick === null
  const isHost = match.hostId === userId
  // Opponents in play order after me (CCW).
  const order: SeatView[] = []
  // Everyone else in play order after me (CCW over this match's 2–4 seats); spectators see all seats.
  const turns = { players: match.seats.length, direction: R.direction }
  if (me) for (let s = seatAfter(me.seat, turns); s !== me.seat; s = seatAfter(s, turns)) order.push(match.seats[s]!)
  else order.push(...match.seats)

  async function act(kind: 'play' | 'pass' | 'abort') {
    if (!match) return
    setPending(true)
    setError(null)
    try {
      if (kind === 'play') await playCards(match.matchId, match.version, selected)
      else if (kind === 'pass') await passTurn(match.matchId, match.version)
      else await abortMatch(match.matchId)
      if (kind !== 'abort') clearSelection()
    } catch (e) {
      // VERSION_CONFLICT: someone else moved first. Refetch silently and keep the selection (ARCHITECTURE §6).
      if (!(e instanceof ApiCallError && e.code === 'VERSION_CONFLICT'))
        setError(e instanceof ApiCallError ? e.message : 'Có lỗi xảy ra, vui lòng thử lại')
    } finally {
      setConfirmAbort(false)
      await refresh()
      setPending(false)
    }
  }

  const winner = match.winnerSeat !== null ? match.seats[match.winnerSeat] : null
  const turnName = match.seats[match.currentSeat]?.displayName

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ConnectionBadge status={connection} />
        {!finished && secondsLeft !== null && (
          <span className={cn('text-sm tabular-nums', secondsLeft <= 5 ? 'font-semibold text-red-600' : 'text-slate-600')}>
            {myTurn ? 'Bạn' : turnName} còn {secondsLeft}s
          </span>
        )}
      </div>

      <ol className={cn('grid gap-2', order.length >= 3 ? 'grid-cols-3' : order.length === 2 ? 'grid-cols-2' : 'grid-cols-1')} aria-label="Đối thủ">
        {order.map((s) => (
          <SeatBadge key={s.seat} seat={s} match={match} online={s.isBot || online.has(s.userId)} />
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
          !finished && <p className="text-center text-white/80">Vòng mới · {turnName} đánh trước</p>
        )}
      </section>

      {finished && (
        <section aria-label="Kết quả" className="grid gap-4 rounded-xl border border-gold bg-white p-4">
          <p className="text-center text-xl font-semibold" role="status">
            {match.status === 'ABORTED'
              ? 'Ván đã bị huỷ (không tính điểm)'
              : !me
                ? `${winner?.displayName ?? 'Ván'} thắng ván này`
              : winner
                ? winner.userId === userId
                  ? 'Bạn thắng ván này! 🏆'
                  : `${winner.displayName} thắng ván này`
                : 'Ván đã kết thúc'}
          </p>
          {!match.ranked && match.status === 'FINISHED' && (
            <p className="text-center text-sm text-slate-600">Ván luyện tập có máy: không cộng/trừ điểm, không ghi vào lịch sử.</p>
          )}
          {results && results.length > 0 && <ResultsTable results={results} userId={userId} />}
          <Button asChild className="mx-auto w-fit">
            <Link to={`/room/${match.roomId}`}>Về phòng</Link>
          </Button>
        </section>
      )}

      {!me && !finished && (
        <p role="status" className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-center text-sm text-slate-600">
          Bạn đang xem ván này. Bạn sẽ được vào chơi từ ván sau khi có ghế trống.
        </p>
      )}

      {me && !finished && (
        <section aria-label="Bài của bạn" className="grid gap-3">
          <div className="flex items-center justify-between text-sm">
            <span className={cn('font-medium', myTurn && 'text-felt')}>
              {myTurn ? 'Đến lượt bạn' : `Chờ ${turnName}…`}
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
            {isHost &&
              (confirmAbort ? (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  Huỷ ván, không tính điểm?
                  <Button variant="destructive" size="sm" disabled={pending} onClick={() => void act('abort')}>
                    Huỷ ván
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmAbort(false)}>
                    Không
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" className="ml-auto text-slate-500" onClick={() => setConfirmAbort(true)}>
                  Huỷ ván…
                </Button>
              ))}
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

function SeatBadge({ seat, match, online }: { seat: SeatView; match: MatchView; online: boolean }) {
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
      <p className="flex items-center gap-1.5 truncate font-medium">
        <span
          aria-label={online ? 'Đang online' : 'Mất kết nối'}
          title={online ? 'Đang online' : 'Mất kết nối'}
          className={cn('size-2 shrink-0 rounded-full', online ? 'bg-emerald-500' : 'bg-slate-300')}
        />
        <span className="truncate">
          {seat.isBot && <span aria-label="Máy">🤖 </span>}
          {seat.displayName}
        </span>
        {match.winnerSeat === seat.seat && ' 🏆'}
      </p>
      <p className="text-slate-600">
        {seat.cardCount} lá{seat.cardCount === 1 && match.status === 'PLAYING' && <span className="ml-1 font-semibold text-red-600">· Báo 1</span>}
      </p>
      <p className="text-xs text-slate-500">
        {[isTurn && 'Đang đánh', passed && 'Đã bỏ', !seat.hasPlayed && 'Chưa đánh'].filter(Boolean).join(' · ') || ' '}
      </p>
    </li>
  )
}

/** Persisted results only: the client never computes scores. */
function ResultsTable({ results, userId }: { results: ResultView[]; userId: string | undefined }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Kết quả ván</caption>
      <thead>
        <tr className="border-b text-left text-slate-500">
          <th className="py-1 font-medium">Người chơi</th>
          <th className="py-1 font-medium">Bài còn lại</th>
          <th className="py-1 text-right font-medium">Điểm</th>
        </tr>
      </thead>
      <tbody>
        {[...results]
          .sort((a, b) => b.scoreDelta - a.scoreDelta)
          .map((r) => (
            <tr key={r.seat} className={cn('border-b last:border-0', r.userId === userId && 'bg-amber-50/60')}>
              <td className="py-2 align-top">
                {r.displayName}
                {r.isWinner && ' 🏆'}
                {r.penalties.cong && <span className="ml-1 rounded bg-red-50 px-1 text-xs text-red-700">Cóng</span>}
                {r.penalties.owed !== undefined && (
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Nợ {r.penalties.owed}, trả hết {-r.scoreDelta} điểm đang có
                  </span>
                )}
              </td>
              <td className="py-2">
                {r.remainingCards === 0 ? (
                  '—'
                ) : (
                  <span className="flex flex-wrap gap-0.5" aria-label={`${r.remainingCards} lá: ${r.remainingHand.join(' ')}`}>
                    {r.remainingHand.map((c) => (
                      <span key={c} className="font-mono text-xs">
                        {c}
                      </span>
                    ))}
                  </span>
                )}
              </td>
              <td className={cn('py-2 text-right font-semibold tabular-nums', r.scoreDelta > 0 ? 'text-emerald-700' : 'text-red-700')}>
                {r.scoreDelta > 0 ? `+${r.scoreDelta}` : r.scoreDelta}
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  )
}
