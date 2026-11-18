import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { classify, parseCards, seatAfter, XAM_BASELINE_V2, type CardCode } from '@engine'
import { Button } from '@/components/ui/button'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { Hand } from '@/components/cards/Hand'
import { RANK_LABEL, SUIT_SYMBOL } from '@/components/cards/cardLabels'
import { CardBackStack, PlayingCard } from '@/components/cards/PlayingCard'
import { useAuthStore } from '@/features/auth/store'
import { useSelectionStore } from '@/features/game/selectionStore'
import { useProfileStore } from '@/features/profile/store'
import { COMBINATION_LABEL } from '@/features/game/labels'
import {
  abortMatch,
  claimTimeout,
  declareSam,
  fetchMatch,
  fetchMyHand,
  fetchResults,
  passTurn,
  playCards,
  startMatch,
  type MatchActionView,
  type MatchView,
  type ResultView,
  type SeatView,
} from '@/features/match/api'
import { ApiCallError } from '@/lib/functions'
import { useTopic } from '@/lib/realtime'
import { playSound } from '@/lib/sound'
import { cn } from '@/lib/utils'

// Only the combination rules are used here (for the "is this a valid play" hint); they are the same
// in v1 and v2. The server is authoritative.
const R = XAM_BASELINE_V2
/** Extra wait after the deadline before claiming, plus random jitter so 4 clients don't all race. */
const CLAIM_GRACE_MS = 1000
const CLAIM_JITTER_MS = 1500
const TURN_SECONDS_MAX = 30

type Load = { state: 'loading' } | { state: 'error' } | { state: 'gone' } | { state: 'ready'; match: MatchView }

const CONFETTI_PIECES = [
  { left: '12%', delay: '0s', bg: 'bg-gold' },
  { left: '24%', delay: '0.12s', bg: 'bg-gold-light' },
  { left: '36%', delay: '0.05s', bg: 'bg-emerald-400' },
  { left: '48%', delay: '0.18s', bg: 'bg-gold' },
  { left: '60%', delay: '0.08s', bg: 'bg-suit-red' },
  { left: '72%', delay: '0.15s', bg: 'bg-gold-light' },
  { left: '84%', delay: '0.03s', bg: 'bg-emerald-400' },
  { left: '92%', delay: '0.2s', bg: 'bg-gold' },
]

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

function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0]!.toUpperCase() : '?'
}

function MiniCardChips({ cards }: { cards: readonly CardCode[] }) {
  const parsed = parseCards(cards)
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {parsed.map((c) => {
        const red = c.suit === 'H' || c.suit === 'D'
        return (
          <span
            key={c.code}
            className={cn(
              'inline-flex items-center rounded bg-ivory/95 px-1 py-0.2 font-mono text-[11px] font-bold shadow-2xs',
              red ? 'text-suit-red' : 'text-suit-black',
            )}
          >
            {RANK_LABEL[c.rank]}
            {SUIT_SYMBOL[c.suit]}
          </span>
        )
      })}
    </span>
  )
}

export function GameTablePage() {
  const { matchId = '' } = useParams()
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.session?.user.id)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [hand, setHand] = useState<CardCode[]>([])
  const [results, setResults] = useState<ResultView[] | null>(null)
  const [actionLog, setActionLog] = useState<MatchActionView[]>([])
  const [pending, setPending] = useState(false)
  const [startingNext, setStartingNext] = useState(false)
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
    setStartingNext(false)
    if (result === 'error') return setLoad({ state: 'error' })
    if (!result.match) return setLoad({ state: 'gone' })
    const m = result.match
    versionRef.current = m.version
    setLoad({ state: 'ready', match: m })
    setHand(result.myHand)
    setResults(result.res)

    if (m.actions && m.actions.length > 0) {
      setActionLog(m.actions)
    } else {
      setActionLog((prev) => {
        if (prev.some((e) => e.version === m.version)) return prev
        const nextEntries: MatchActionView[] = []
        if (m.currentTrick) {
          nextEntries.push({
            id: `v-${m.version}-play`,
            version: m.version,
            seat: m.leadSeat,
            kind: 'PLAY',
            cards: [...m.currentTrick.cards],
            combination: m.currentTrick.type,
          })
        } else if (m.samSeat != null && m.version <= 2) {
          nextEntries.push({
            id: `v-${m.version}-sam`,
            version: m.version,
            seat: m.samSeat,
            kind: 'DECLARE_SAM',
          })
        } else {
          nextEntries.push({
            id: `v-${m.version}-round`,
            version: m.version,
            seat: m.leadSeat,
            kind: 'ROUND_RESET',
          })
        }
        return [...nextEntries, ...prev].slice(0, 12)
      })
    }
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
  // Presence on the room topic + auto-navigate when the next match starts in this room!
  const { online } = useTopic(
    match ? `room:${match.roomId}` : null,
    (event, payload) => {
      if (event === 'match_started' && typeof payload.matchId === 'string' && payload.matchId !== matchId) {
        navigate(`/match/${payload.matchId}`)
      }
    },
    () => {},
    { presenceKey: userId },
  )

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

  // Sound cues driven by state transitions (purely decorative)
  const prevVersionRef = useRef<number | null>(null)
  const prevTrickKeyRef = useRef<string | null>(null)
  const prevPassedCountRef = useRef<number>(0)
  const prevMyTurnRef = useRef<boolean>(false)
  const prevStatusRef = useRef<string | null>(null)

  useEffect(() => {
    if (!match) return
    const meSeat = match.seats.find((s) => s.userId === userId)
    const isMyTurnNow = match.status === 'PLAYING' && meSeat?.seat === match.currentSeat
    const trickKey = match.currentTrick ? match.currentTrick.cards.join(',') : null

    if (prevVersionRef.current === null) {
      if (match.status === 'PLAYING') playSound('deal')
    } else if (match.version !== prevVersionRef.current) {
      if (match.status === 'FINISHED' && prevStatusRef.current !== 'FINISHED') {
        const winSeat = match.winnerSeat !== null ? match.seats[match.winnerSeat] : null
        playSound(winSeat?.userId === userId ? 'win' : 'lose')
      } else if (trickKey && trickKey !== prevTrickKeyRef.current) {
        playSound('play')
      } else if (match.passedSeats.length > prevPassedCountRef.current) {
        playSound('pass')
      }
      if (isMyTurnNow && !prevMyTurnRef.current) {
        playSound('turn')
      }
    }

    prevVersionRef.current = match.version
    prevTrickKeyRef.current = trickKey
    prevPassedCountRef.current = match.passedSeats.length
    prevMyTurnRef.current = isMyTurnNow
    prevStatusRef.current = match.status
  }, [match, userId])

  useEffect(() => {
    if (!playing || secondsLeft === null) return
    if (secondsLeft >= 1 && secondsLeft <= 5) {
      playSound('tick')
    }
  }, [playing, secondsLeft])

  if (load.state === 'loading')
    return (
      <div role="status" className="grid gap-4">
        <span className="sr-only">Đang tải bàn chơi…</span>
        <div className="casino-table-surface grid min-h-[34rem] gap-6 rounded-[2.5rem] p-5 sm:p-8 lg:min-h-[42rem]">
          <div className="grid grid-cols-3 gap-4">
            <div className="h-20 animate-pulse rounded-xl bg-white/10" />
            <div className="h-20 animate-pulse rounded-xl bg-white/10" />
            <div className="h-20 animate-pulse rounded-xl bg-white/10" />
          </div>
          <div className="mx-auto h-36 w-72 animate-pulse rounded-2xl bg-white/10" />
          <div className="mx-auto h-24 w-80 animate-pulse rounded-xl bg-white/10" />
        </div>
      </div>
    )
  if (load.state === 'error')
    return (
      <div role="alert" className="rounded-xl border border-suit-red/30 bg-red-50 p-4 text-sm font-medium text-suit-red">
        Không tải được bàn chơi. Vui lòng tải lại trang.
      </div>
    )
  if (load.state === 'gone' || !match)
    return (
      <div className="grid justify-items-center gap-4 rounded-2xl border border-card-border bg-ivory p-8 text-center shadow-xs">
        <p className="text-slate-700">Không tìm thấy ván này, hoặc bạn không tham gia ván.</p>
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
  const canDeclareSam = !finished && Boolean(me) && match.samSeat == null && match.seats.every((s) => !s.hasPlayed)
  const samPlayer = match.samSeat != null ? match.seats[match.samSeat] : null
  const foulPlayer = match.foulSeat != null ? match.seats[match.foulSeat] : null
  const isLastPlayTwoWarning =
    selected.length === hand.length && hand.length > 0 && Boolean(hint && hint.type !== 'STRAIGHT' && hint.keyRank === 15)

  // Opponents in play order after me (CCW).
  const order: SeatView[] = []
  // Everyone else in play order after me (CCW over this match's 2–4 seats); spectators see all seats.
  const turns = { players: match.seats.length, direction: R.direction }
  if (me) for (let s = seatAfter(me.seat, turns); s !== me.seat; s = seatAfter(s, turns)) order.push(match.seats[s]!)
  else order.push(...match.seats)

  async function act(kind: 'play' | 'pass' | 'abort' | 'sam') {
    if (!match) return
    setPending(true)
    setError(null)
    try {
      if (kind === 'play') await playCards(match.matchId, match.version, selected)
      else if (kind === 'pass') await passTurn(match.matchId, match.version)
      else if (kind === 'sam') {
        playSound('turn')
        await declareSam(match.matchId, match.version)
      } else await abortMatch(match.matchId)
      if (kind !== 'abort' && kind !== 'sam') clearSelection()
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

  async function onContinueNextMatch() {
    if (!match) return
    setStartingNext(true)
    setError(null)
    try {
      playSound('deal')
      const next = await startMatch(match.roomId)
      navigate(`/match/${next.matchId}`)
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : 'Không thể bắt đầu ván tiếp theo')
      setStartingNext(false)
    }
  }

  const winner = match.winnerSeat !== null ? match.seats[match.winnerSeat] : null
  const turnName = match.seats[match.currentSeat]?.displayName

  // Position classes for seats around the table while preserving exact DOM order (CCW: right -> top -> left)
  function seatPositionClass(idx: number, total: number): string {
    if (total === 1) {
      return 'mx-auto w-full max-w-[16rem]'
    }
    if (total === 2) {
      return idx === 0 ? 'col-start-2 row-start-1' : 'col-start-1 row-start-1'
    }
    if (total === 3) {
      if (idx === 1) return 'col-span-2 row-start-1 mx-auto w-full max-w-[15rem] sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:max-w-[17rem]'
      if (idx === 2) return 'col-start-1 row-start-2 sm:col-start-1 sm:row-start-1 sm:mt-8'
      return 'col-start-2 row-start-2 sm:col-start-3 sm:row-start-1 sm:mt-8'
    }
    return ''
  }

  return (
    <div className="grid min-w-0 gap-3">
      {/* Grand Luxury Casino Arena Table */}
      <div className="casino-table-surface relative flex min-h-[34rem] flex-col justify-between gap-4 overflow-hidden rounded-[2rem] p-3.5 sm:min-h-[38rem] sm:gap-5 sm:rounded-[3rem] sm:p-6 lg:min-h-[calc(100vh-6.75rem)] lg:p-7">
        {/* Corner Filigree Ornaments */}
        <span aria-hidden className="pointer-events-none absolute left-4 top-3 text-xs text-gold/30 select-none sm:text-sm">
          ❖
        </span>
        <span aria-hidden className="pointer-events-none absolute right-4 top-3 text-xs text-gold/30 select-none sm:text-sm">
          ❖
        </span>

        {/* Integrated Frosted-Glass Table Top HUD Bar */}
        <div className="z-10 flex flex-wrap items-center justify-between gap-2 rounded-full border border-gold/25 bg-black/35 px-3.5 py-1.5 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <ConnectionBadge status={connection} />
            <span className="hidden rounded-full border border-gold/30 bg-white/8 px-2.5 py-0.5 text-xs font-semibold text-gold-light sm:inline-block">
              {match.ranked ? '♠ Bàn VIP Tính Điểm' : '✦ Bàn Luyện Tập'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {!finished && secondsLeft !== null && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold tabular-nums shadow-2xs sm:text-sm',
                  secondsLeft <= 5
                    ? 'bg-suit-red text-white ring-1 ring-red-300'
                    : myTurn
                      ? 'bg-gradient-to-r from-gold-light to-gold text-wood-dark ring-1 ring-gold-bright'
                      : 'border border-gold/30 bg-black/40 text-ivory',
                )}
              >
                <span aria-hidden className={cn('size-1.5 rounded-full', secondsLeft <= 5 ? 'bg-white' : 'bg-wood-dark')} />
                {myTurn ? 'Bạn' : turnName} còn {secondsLeft}s
              </span>
            )}
            <Link
              to={`/room/${match.roomId}`}
              className="rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 text-xs font-medium text-ivory/80 transition-colors hover:border-gold/50 hover:text-gold-light"
            >
              Phòng chờ
            </Link>
          </div>
        </div>

        {/* Opponents seated around the top/sides of the table */}
        <ol
          className={cn(
            'z-10 grid gap-2.5 sm:gap-4',
            order.length === 3
              ? 'grid-cols-2 sm:grid-cols-3'
              : order.length === 2
                ? 'grid-cols-2'
                : order.length >= 4
                  ? 'grid-cols-2 sm:grid-cols-4'
                  : 'grid-cols-1',
          )}
          aria-label="Đối thủ"
        >
          {order.map((s, idx) => (
            <SeatBadge
              key={s.seat}
              seat={s}
              match={match}
              online={s.isBot || online.has(s.userId)}
              secondsLeft={match.currentSeat === s.seat && !finished ? secondsLeft : null}
              className={seatPositionClass(idx, order.length)}
            />
          ))}
        </ol>

        {/* Center Arena + Right-Side Frosted Glass Move History Panel */}
        <div className="relative z-10 grid flex-1 items-center gap-3 lg:grid-cols-[1fr_16.5rem]">
          {/* Center Felt Arena (`Bài trên bàn`) with Centered Frosted-Glass Notifications */}
          <section
            aria-label="Bài trên bàn"
            className="casino-felt-ring relative flex min-h-48 flex-col items-center justify-center gap-3 rounded-[2rem] bg-felt-dark/40 px-3 py-5 sm:min-h-60 sm:px-6 lg:min-h-68"
          >
            {/* Ornate Center Casino Crest Watermark */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center select-none"
            >
              <div className="flex flex-col items-center justify-center rounded-full border border-gold/12 px-10 py-6">
                <span className="font-display text-xs tracking-[0.35em] text-gold-light/15 uppercase sm:text-base">
                  ♠ Xâm Online ♠
                </span>
                <span className="mt-1 text-[10px] tracking-[0.2em] text-gold-light/10 uppercase">
                  Royal Casino Club
                </span>
              </div>
            </div>

            {/* Active Báo Xâm Alert (Frosted Glass in Center of Table) */}
            {samPlayer && !finished && (
              <div className="z-10 flex items-center gap-2 rounded-full border border-gold/70 bg-suit-red-dark/75 px-4 py-1 text-center text-xs font-bold text-gold-light shadow-lg backdrop-blur-md sm:text-sm">
                <span aria-hidden>🔥</span>
                <span>
                  {samPlayer.userId === userId ? 'Bạn' : samPlayer.displayName} đã <strong>BÁO XÂM</strong> (đi trước · ai chặn được thắng ngay!)
                </span>
              </div>
            )}

            {/* Center Played Trick or New Round Notice */}
            {match.currentTrick ? (
              <div key={match.version} className="z-10 grid justify-items-center gap-3">
                <p className="rounded-full border border-gold/40 bg-black/45 px-4 py-1 text-xs font-semibold text-gold-light shadow-md backdrop-blur-md sm:text-sm">
                  {match.seats[match.leadSeat]?.displayName} · {COMBINATION_LABEL[match.currentTrick.type]}
                </p>
                <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2.5">
                  {parseCards(match.currentTrick.cards).map((c) => (
                    <PlayingCard key={`${match.version}-${c.code}`} card={c} className="animate-card-play shadow-xl" />
                  ))}
                </div>
              </div>
            ) : (
              !finished && (
                <div key={`round-${match.leadSeat}-${match.version}`} className="animate-round-new z-10 grid justify-items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-flex size-9 items-center justify-center rounded-full border border-gold/35 bg-black/35 text-base text-gold-light backdrop-blur-md"
                  >
                    ✦
                  </span>
                  <p className="rounded-full border border-gold/40 bg-black/45 px-5 py-1.5 text-center text-xs font-semibold text-ivory shadow-md backdrop-blur-md sm:text-sm">
                    Vòng mới · {turnName} đánh trước
                  </p>
                </div>
              )
            )}

            {/* Centered Frosted-Glass Turn / Combination / Warning / Error Notification HUD */}
            {me && !finished && (
              <div className="z-10 mt-1 flex flex-col items-center gap-1.5">
                <p
                  className={cn(
                    'rounded-full border px-4 py-1 text-center text-xs font-semibold shadow-sm backdrop-blur-md transition-all sm:text-sm',
                    isLastPlayTwoWarning
                      ? 'border-red-400/70 bg-red-950/75 font-bold text-red-200'
                      : selected.length > 0
                        ? hint
                          ? 'border-gold/60 bg-black/50 text-gold-light'
                          : 'border-red-400/60 bg-red-950/65 text-red-200'
                        : myTurn
                          ? 'border-gold/40 bg-black/45 text-gold-light'
                          : 'border-white/15 bg-black/30 text-ivory/80',
                  )}
                  aria-live="polite"
                >
                  {isLastPlayTwoWarning
                    ? `⚠ Cảnh báo: Đánh ${COMBINATION_LABEL[hint!.type]} 2 cuối cùng sẽ bị xử thua (Thối 2)!`
                    : selected.length === 0
                      ? myTurn
                        ? leading
                          ? 'Bạn dẫn vòng: đánh bộ bất kỳ'
                          : 'Chọn bộ lớn hơn để chặn, hoặc bỏ lượt'
                        : `Đang chờ ${turnName} suy nghĩ…`
                      : hint
                        ? `${COMBINATION_LABEL[hint.type]} (${hint.size} lá)`
                        : 'Chưa phải bộ hợp lệ'}
                </p>

                {error && (
                  <p
                    role="alert"
                    className="rounded-full border border-red-400/60 bg-red-950/80 px-4 py-1 text-center text-xs font-semibold text-red-200 shadow-md backdrop-blur-md sm:text-sm"
                  >
                    {error}
                  </p>
                )}
              </div>
            )}

            {/* Centered Frosted-Glass Spectator Banner */}
            {!me && !finished && (
              <p
                role="status"
                className="z-10 max-w-md rounded-2xl border border-gold/40 bg-black/50 px-5 py-3 text-center text-sm font-medium text-ivory shadow-lg backdrop-blur-md"
              >
                Bạn đang xem ván này. Bạn sẽ được vào chơi từ ván sau khi có ghế trống.
              </p>
            )}
          </section>

          {/* Right-Side Frosted Glass Mini Action History Panel (`Lịch sử đánh`) */}
          <aside
            aria-label="Diễn biến ván"
            className="flex max-h-40 flex-col rounded-2xl border border-gold/25 bg-black/35 p-3 text-xs text-ivory/90 shadow-lg backdrop-blur-md lg:h-full lg:max-h-68"
          >
            <div className="mb-2 flex items-center justify-between border-b border-gold/20 pb-1.5">
              <span className="font-display text-xs font-bold tracking-wide text-gold-light uppercase">
                📜 Diễn biến ván
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.2 text-[10px] font-semibold tabular-nums text-ivory/75">
                #{match.version}
              </span>
            </div>

            {actionLog.length === 0 ? (
              <p className="my-auto text-center text-ivory/50">Ván mới bắt đầu…</p>
            ) : (
              <ul className="grid gap-1.5 overflow-y-auto pr-1">
                {actionLog.map((item) => {
                  const seatName =
                    item.seat !== null ? (match.seats[item.seat]?.displayName ?? `Ghế ${item.seat + 1}`) : 'Hệ thống'
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-white/8 bg-white/5 px-2.5 py-1.5"
                    >
                      <span className="truncate font-semibold text-gold-light/95">{seatName}</span>
                      {item.kind === 'PLAY' && item.cards ? (
                        <span className="flex flex-wrap items-center gap-1">
                          {item.combination && (
                            <span className="text-[11px] text-ivory/75">{COMBINATION_LABEL[item.combination]}:</span>
                          )}
                          <MiniCardChips cards={item.cards} />
                        </span>
                      ) : item.kind === 'PASS' ? (
                        <span className="rounded bg-white/10 px-1.5 py-0.2 text-[11px] text-ivory/70">Bỏ lượt</span>
                      ) : item.kind === 'DECLARE_SAM' ? (
                        <span className="rounded bg-suit-red px-1.5 py-0.2 text-[11px] font-bold text-gold-light">
                          🔥 Báo Xâm
                        </span>
                      ) : item.kind === 'ROUND_RESET' ? (
                        <span className="text-[11px] text-emerald-300">✦ Dẫn vòng mới</span>
                      ) : (
                        <span className="text-[11px] text-ivory/65">Chia bài</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>
        </div>

        {/* My Seat & Hand Dock at the Bottom of the Table */}
        {me && !finished && (
          <section
            aria-label="Bài của bạn"
            className={cn(
              'z-10 grid gap-2.5 rounded-2xl border p-3 backdrop-blur-md transition-all sm:p-4',
              myTurn
                ? 'border-gold bg-black/45 shadow-[0_0_28px_rgba(212,160,23,0.28)]'
                : 'border-white/12 bg-black/35',
            )}
          >
            {/* My Seat Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={cn(
                    'inline-flex size-8 items-center justify-center rounded-full text-xs font-extrabold shadow-inner ring-2',
                    myTurn ? 'bg-gold text-wood-dark ring-gold-light' : 'bg-felt text-gold-light ring-gold/40',
                  )}
                >
                  {initialOf(me.displayName)}
                </span>
                <span className={cn('font-bold', myTurn ? 'text-gold-light' : 'text-ivory/85')}>
                  {myTurn ? 'Đến lượt bạn' : `Chờ ${turnName}…`}
                </span>
                {match.samSeat === me.seat && (
                  <span className="rounded-full border border-gold bg-suit-red px-2.5 py-0.5 text-xs font-bold text-gold-light shadow-2xs">
                    🔥 Đang Báo Xâm
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {hand.length === 1 && (
                  <span className="rounded-full bg-suit-red px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs">
                    Báo 1
                  </span>
                )}
                <span className="rounded-full border border-gold/35 bg-black/45 px-3 py-0.5 text-xs font-bold tabular-nums text-gold-light">
                  {hand.length} lá
                </span>
              </div>
            </div>

            {/* Turn progress bar for my seat */}
            {myTurn && secondsLeft !== null && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/12" aria-hidden>
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    secondsLeft <= 5 ? 'bg-suit-red' : 'bg-gradient-to-r from-gold-dark via-gold to-gold-light',
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, (secondsLeft / TURN_SECONDS_MAX) * 100))}%` }}
                />
              </div>
            )}

            {/* Player Hand (10 cards stacked, fits 375px with zero overflow, grand size on desktop) */}
            <Hand cards={hand} disabled={pending} />

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1 sm:justify-between">
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <Button
                  variant="gold"
                  disabled={!myTurn || pending || !hint}
                  onClick={() => void act('play')}
                  className="min-w-28 font-bold shadow-md"
                >
                  Đánh
                </Button>
                <Button
                  variant="outline"
                  disabled={!myTurn || pending || leading}
                  onClick={() => void act('pass')}
                  className="border-gold/40 bg-felt-dark/80 text-ivory hover:border-gold hover:bg-felt-dark"
                >
                  Bỏ lượt
                </Button>
                {canDeclareSam && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void act('sam')}
                    title="Báo Xâm: Xin đi trước và đánh hết bài không ai chặn được (nếu bị chặn sẽ xử thua)"
                    className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-gold bg-gradient-to-b from-suit-red to-suit-red-dark px-4 py-2 text-sm font-extrabold text-gold-light shadow-[0_0_16px_rgba(212,160,23,0.45)] transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <span aria-hidden>🔥</span>
                    <span>Báo Xâm</span>
                  </button>
                )}
              </div>

              {isHost &&
                (confirmAbort ? (
                  <span className="flex flex-wrap items-center gap-2 rounded-lg border border-red-400/30 bg-red-950/75 px-2.5 py-1 text-xs text-red-100 backdrop-blur-md sm:text-sm">
                    Huỷ ván, không tính điểm?
                    <Button variant="destructive" size="sm" disabled={pending} onClick={() => void act('abort')}>
                      Huỷ ván
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-ivory/80 hover:bg-white/10 hover:text-white"
                      onClick={() => setConfirmAbort(false)}
                    >
                      Không
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-ivory/65 hover:bg-white/10 hover:text-ivory"
                    onClick={() => setConfirmAbort(true)}
                  >
                    Huỷ ván…
                  </Button>
                ))}
            </div>
          </section>
        )}

        {/* Centered Frosted-Glass Match Results Modal Overlay (`Kết quả`) right inside the table */}
        {finished && (
          <div className="inset-0 z-30 flex items-center justify-center rounded-[1.75rem] bg-black/55 p-3 backdrop-blur-md sm:absolute sm:p-6">
            <section
              aria-label="Kết quả"
              className="relative grid w-full max-w-xl min-w-0 gap-4 overflow-hidden rounded-2xl border-2 border-gold bg-ivory/95 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)] backdrop-blur-md sm:p-6"
            >
              {/* Subtle confetti on finished match (<= 2s, disabled under prefers-reduced-motion) */}
              {match.status === 'FINISHED' && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 overflow-hidden">
                  {CONFETTI_PIECES.map((p, i) => (
                    <span
                      key={i}
                      style={{ left: p.left, animationDelay: p.delay }}
                      className={cn('animate-confetti absolute top-0 size-2 rounded-xs opacity-0', p.bg)}
                    />
                  ))}
                </div>
              )}

              <div className="grid justify-items-center gap-2 text-center">
                <span
                  aria-hidden
                  className="inline-flex size-12 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-2xl shadow-md ring-4 ring-gold/25"
                >
                  {match.status === 'ABORTED' ? '✕' : '👑'}
                </span>
                <p className="font-display text-xl font-bold text-slate-900 sm:text-2xl" role="status">
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

                {/* Special Reason Badge (Thối 2 cuối / Bắt Xâm / Ăn Xâm) */}
                {match.endReason === 'THOI_2_CUOI' && foulPlayer && (
                  <p className="rounded-xl border border-suit-red/40 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-suit-red sm:text-sm">
                    ⚠ {foulPlayer.displayName} đánh cây 2 cuối cùng nên bị xử thua (Thối 2)!
                  </p>
                )}
                {match.endReason === 'SAM_CAUGHT' && foulPlayer && winner && (
                  <p className="rounded-xl border border-suit-red/40 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-suit-red sm:text-sm">
                    🛡️ {winner.displayName} đã chặn được bài Báo Xâm của {foulPlayer.displayName} và thắng ngay!
                  </p>
                )}
                {match.endReason === 'SAM_SUCCESS' && winner && (
                  <p className="rounded-xl border border-gold bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900 sm:text-sm">
                    🔥 {winner.displayName} Báo Xâm thành công, không ai chặn được!
                  </p>
                )}

                {!match.ranked && match.status === 'FINISHED' && (
                  <p className="rounded-full border border-gold/40 bg-amber-50/80 px-3.5 py-1 text-xs font-medium text-amber-900 sm:text-sm">
                    Ván luyện tập có máy: không cộng/trừ điểm, không ghi vào lịch sử.
                  </p>
                )}
                {winner && match.status === 'FINISHED' && (
                  <p className="text-xs text-slate-600">
                    Ván tiếp theo: <strong>{winner.displayName}</strong> (nhất ván này) sẽ được đánh trước.
                  </p>
                )}
              </div>

              {results && results.length > 0 && <ResultsTable results={results} userId={userId} />}

              <div className="flex flex-wrap items-center justify-center gap-3">
                {me && (
                  <Button
                    variant="gold"
                    disabled={startingNext}
                    onClick={() => void onContinueNextMatch()}
                    className="px-6 font-bold shadow-md"
                  >
                    {startingNext ? 'Đang chia bài ván mới…' : 'Tiếp tục ván mới'}
                  </Button>
                )}
                <Button asChild variant={me ? 'outline' : 'gold'} className="w-fit px-5 font-semibold">
                  <Link to={`/room/${match.roomId}`}>Về phòng</Link>
                </Button>
              </div>

              {error && (
                <p role="alert" className="text-center text-sm font-medium text-suit-red">
                  {error}
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function SeatBadge({
  seat,
  match,
  online,
  secondsLeft,
  className,
}: {
  seat: SeatView
  match: MatchView
  online: boolean
  secondsLeft: number | null
  className?: string
}) {
  const isTurn = match.status === 'PLAYING' && match.currentSeat === seat.seat
  const passed = match.passedSeats.includes(seat.seat)
  const isWinner = match.winnerSeat === seat.seat
  const isSam = match.samSeat === seat.seat
  const progress =
    isTurn && secondsLeft !== null ? Math.min(1, Math.max(0, secondsLeft / TURN_SECONDS_MAX)) : 0
  const circumference = 2 * Math.PI * 18

  return (
    <li
      aria-current={isTurn ? 'true' : undefined}
      className={cn(
        'relative flex items-center gap-3 rounded-2xl border bg-black/40 p-2.5 text-sm text-ivory shadow-md backdrop-blur-md transition-all sm:p-3',
        isTurn
          ? 'animate-turn-seat border-gold bg-black/60'
          : isSam
            ? 'border-suit-red ring-1 ring-gold'
            : 'border-gold/25',
        passed && 'opacity-65',
        className,
      )}
    >
      {/* Avatar with optional 30s SVG countdown ring */}
      <div className="relative flex size-11 shrink-0 items-center justify-center" aria-hidden>
        {isTurn && secondsLeft !== null && (
          <svg className="absolute inset-0 size-11 -rotate-90" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2.5" />
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              stroke={secondsLeft <= 5 ? '#ef4444' : '#f3d478'}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
            />
          </svg>
        )}
        <span
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-full text-xs font-extrabold shadow-inner ring-1',
            seat.isBot
              ? 'bg-wood text-gold-light ring-gold/40'
              : isTurn
                ? 'bg-gold text-wood-dark ring-gold-light'
                : 'bg-felt text-ivory ring-white/25',
          )}
        >
          {seat.isBot ? '⚙' : initialOf(seat.displayName)}
        </span>
      </div>

      {/* Seat details: Note `li p:first-child` is kept intact for unit test compatibility */}
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex items-center gap-1.5 truncate font-semibold text-ivory">
          <span
            aria-label={online ? 'Đang online' : 'Mất kết nối'}
            title={online ? 'Đang online' : 'Mất kết nối'}
            className={cn('size-2 shrink-0 rounded-full', online ? 'bg-emerald-400' : 'bg-slate-400')}
          />
          <span className="truncate">
            {seat.isBot && <span aria-label="Máy">🤖 </span>}
            {seat.displayName}
          </span>
          {isWinner && ' 🏆'}
        </p>

        <div className="flex items-center gap-2">
          <CardBackStack count={seat.cardCount} />
          <p className="text-xs font-semibold text-gold-light/95">
            {seat.cardCount} lá
            {seat.cardCount === 1 && match.status === 'PLAYING' && (
              <span className="ml-1.5 inline-block rounded bg-suit-red px-1.5 py-0.2 text-[11px] font-bold text-white">
                · Báo 1
              </span>
            )}
            {isSam && match.status === 'PLAYING' && (
              <span className="ml-1.5 inline-block rounded bg-suit-red px-1.5 py-0.2 text-[11px] font-bold text-gold-light">
                · Báo Xâm
              </span>
            )}
          </p>
        </div>

        <p className="truncate text-[11px] text-ivory/70">
          {[isTurn && 'Đang đánh', passed && 'Đã bỏ', !seat.hasPlayed && 'Chưa đánh'].filter(Boolean).join(' · ') ||
            '\u00A0'}
        </p>
      </div>
    </li>
  )
}

/** Persisted results only: the client never computes scores. */
function ResultsTable({ results, userId }: { results: ResultView[]; userId: string | undefined }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-white">
      <table className="w-full text-sm">
        <caption className="sr-only">Kết quả ván</caption>
        <thead>
          <tr className="border-b border-card-border bg-cream/70 text-left text-xs font-semibold tracking-wider text-slate-600 uppercase">
            <th className="px-3 py-2.5">Người chơi</th>
            <th className="px-3 py-2.5">Bài còn lại</th>
            <th className="px-3 py-2.5 text-right">Điểm</th>
          </tr>
        </thead>
        <tbody>
          {[...results]
            .sort((a, b) => b.scoreDelta - a.scoreDelta)
            .map((r) => (
              <tr
                key={r.seat}
                className={cn(
                  'border-b border-card-border/60 last:border-0',
                  r.userId === userId && 'bg-amber-50/70',
                  r.isWinner && 'font-medium',
                )}
              >
                <td className="px-3 py-2.5 align-top">
                  <span className="font-semibold text-slate-900">{r.displayName}</span>
                  {r.isWinner && ' 🏆'}
                  {r.penalties.cong && (
                    <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-suit-red">
                      Cóng
                    </span>
                  )}
                  {r.penalties.thoi2Cuoi && (
                    <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-suit-red">
                      Thối 2 cuối
                    </span>
                  )}
                  {r.penalties.denSam && (
                    <span className="ml-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-suit-red">
                      Đền Xâm
                    </span>
                  )}
                  {!r.penalties.thoi2Cuoi && r.penalties.thoi2 && r.penalties.thoi2 > 0 && (
                    <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Thối {r.penalties.thoi2} cây 2
                    </span>
                  )}
                  {r.penalties.owed !== undefined && (
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      Nợ {r.penalties.owed}, trả hết {-r.scoreDelta} điểm đang có
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top">
                  {r.remainingCards === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span
                      className="flex flex-wrap gap-1"
                      aria-label={`${r.remainingCards} lá: ${r.remainingHand.join(' ')}`}
                    >
                      {r.remainingHand.map((c) => (
                        <span
                          key={c}
                          className="rounded border border-card-border bg-cream px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800"
                        >
                          {c}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-right text-base font-bold tabular-nums align-top',
                    r.scoreDelta > 0 ? 'text-emerald-700' : r.scoreDelta < 0 ? 'text-suit-red' : 'text-slate-600',
                  )}
                >
                  {r.scoreDelta > 0 ? `+${r.scoreDelta}` : r.scoreDelta}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
