import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { classify, parseCards, seatAfter, XAM_BASELINE_V2, type CardCode, type Combination } from '@engine'
import { Button } from '@/components/ui/button'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { Avatar } from '@/components/Avatar'
import { ChatPanel, type ChatPerson } from '@/components/chat/ChatPanel'
import { EmoteBar } from '@/components/chat/EmoteBar'
import { EmoteBubble } from '@/components/chat/EmoteBubble'
import { useRoomChat } from '@/features/chat/useRoomChat'
import { Hand } from '@/components/cards/Hand'
import { RANK_LABEL, SUIT_SYMBOL } from '@/components/cards/cardLabels'
import { PlayingCard } from '@/components/cards/PlayingCard'
import { useAuthStore } from '@/features/auth/store'
import { useSelectionStore } from '@/features/game/selectionStore'
import { useProfileStore } from '@/features/profile/store'
import { COMBINATION_LABEL } from '@/features/game/labels'
import { useDealAnimation } from '@/features/game/effects/useDealAnimation'
import { CardFlightLayer } from '@/features/game/effects/CardFlightLayer'
import { ChopBurst } from '@/features/game/effects/ChopBurst'
import { SeatBadge } from '@/features/game/components/SeatBadge'
import { ResultsModal } from '@/features/game/components/ResultsModal'
import { RoomScoreboard, type ScoreboardEntry } from '@/features/game/components/RoomScoreboard'
import { RotateDeviceHint } from '@/features/game/components/RotateDeviceHint'
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
import { enterLandscapeFullscreen } from '@/lib/fullscreen'
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

/** Whole seconds left until `deadline`, ticking every 250 ms and clamped to 0..TURN_SECONDS_MAX. */
function useSecondsLeft(deadline: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const sync = setTimeout(() => setNow(Date.now()), 0)
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => {
      clearTimeout(sync)
      clearInterval(id)
    }
  }, [deadline])
  if (!deadline) return null
  const ms = Date.parse(deadline)
  if (Number.isNaN(ms)) return null
  return Math.min(TURN_SECONDS_MAX, Math.max(0, Math.ceil((ms - now) / 1000)))
}

/** Deterministic subtle rotation angle based strictly on card code (zero random flicker). */
function cardTiltDeg(code: string): number {
  let h = 0
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) % 97
  return Number((((h % 9) - 4) * 0.85).toFixed(2))
}

/** Vector offset from a seat position toward or away from center table for flight & sweep effects. */
function seatVectorOffset(
  seat: number,
  meSeat: number | undefined,
  order: readonly SeatView[],
): { x: string; y: string } {
  if (meSeat !== undefined && seat === meSeat) return { x: '0px', y: '115px' }
  const idx = order.findIndex((s) => s.seat === seat)
  const total = order.length
  if (total <= 1 || idx === -1) return { x: '0px', y: '-110px' }
  if (total === 2) return idx === 0 ? { x: '135px', y: '-80px' } : { x: '-135px', y: '-80px' }
  if (total === 3) {
    if (idx === 0) return { x: '175px', y: '-35px' }
    if (idx === 1) return { x: '0px', y: '-115px' }
    return { x: '-175px', y: '-35px' }
  }
  if (idx === 0) return { x: '205px', y: '-55px' }
  if (idx === 1) return { x: '85px', y: '-115px' }
  if (idx === 2) return { x: '-85px', y: '-115px' }
  return { x: '-205px', y: '-55px' }
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
  const [chatOpen, setChatOpen] = useState(false)
  const [emotesOpen, setEmotesOpen] = useState(false)
  const [seenChatId, setSeenChatId] = useState(0)
  const [scoresOpen, setScoresOpen] = useState(false)
  const [fullscreenSupported] = useState(() => typeof document !== 'undefined' && Boolean(document.fullscreenEnabled))
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [chopBurst, setChopBurst] = useState(false)
  const [sweptTrick, setSweptTrick] = useState<{ cards: readonly CardCode[]; toX: string; toY: string; key: number } | null>(
    null,
  )

  const selected = useSelectionStore((s) => s.selected)
  const clearSelection = useSelectionStore((s) => s.clear)
  const versionRef = useRef(0)
  const deadlineByVersionRef = useRef<{ matchId: string; version: number; raw: string; normalized: string } | null>(null)
  const tableRef = useRef<HTMLDivElement | null>(null)
  const targetRefs = useRef<Map<string, HTMLElement | null>>(new Map())
  const chopTimerRef = useRef<number | null>(null)
  const sweepTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const refreshProfile = useProfileStore((s) => s.refresh)
  const profilePoints = useProfileStore((s) => s.profile?.total_score)

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
    const raw = result.match
    let m = raw
    if (raw.status === 'PLAYING' && raw.turnDeadline) {
      const cached = deadlineByVersionRef.current
      let normalized: string
      if (
        cached &&
        cached.matchId === raw.matchId &&
        cached.version === raw.version &&
        cached.raw === raw.turnDeadline
      ) {
        normalized = cached.normalized
      } else {
        const now = Date.now()
        const parsed = Date.parse(raw.turnDeadline)
        const diff = parsed - now
        if (!Number.isNaN(parsed) && (diff > TURN_SECONDS_MAX * 1000 || diff < -60_000)) {
          normalized = new Date(now + TURN_SECONDS_MAX * 1000).toISOString()
        } else {
          normalized = raw.turnDeadline
        }
        deadlineByVersionRef.current = {
          matchId: raw.matchId,
          version: raw.version,
          raw: raw.turnDeadline,
          normalized,
        }
      }
      if (normalized !== raw.turnDeadline) {
        m = { ...raw, turnDeadline: normalized }
      }
    } else {
      deadlineByVersionRef.current = null
    }
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
  const chat = useRoomChat(match?.roomId ?? null)
  const { online } = useTopic(
    match ? `room:${match.roomId}` : null,
    (event, payload) => {
      if (event === 'chat') chat.receive(payload)
      else if (event === 'match_started' && typeof payload.matchId === 'string' && payload.matchId !== matchId) {
        navigate(`/match/${payload.matchId}`)
      }
    },
    () => chat.reload(),
    { presenceKey: userId },
  )

  // Deal animation (once per matchId)
  const deal = useDealAnimation(matchId, match?.status, match?.version, match?.seats.length ?? 0)

  // Turn timeout [R27]: once the deadline passes, any open client claims it. The server decides.
  const playing = match?.status === 'PLAYING'
  const deadline = playing ? match.turnDeadline : null
  const version = match?.version
  useEffect(() => {
    if (!deadline || version === undefined) return
    const wait = Date.parse(deadline) - Date.now() + CLAIM_GRACE_MS + Math.random() * CLAIM_JITTER_MS
    const id = setTimeout(() => {
      void claimTimeout(matchId, version)
        .catch(() => {})
        .then(refresh)
    }, Math.max(0, wait))
    return () => clearTimeout(id)
  }, [deadline, version, matchId, refresh])

  // Refresh profile points after finished match.
  const finishedNow = match?.status === 'FINISHED'
  useEffect(() => {
    if (finishedNow && userId) void refreshProfile(userId)
  }, [finishedNow, userId, refreshProfile])

  const secondsLeft = useSecondsLeft(deadline)
  const hint = useMemo(() => (selected.length ? classify(parseCards(selected), R) : null), [selected])

  // Sound cues & state transition visual effects
  const prevVersionRef = useRef<number | null>(null)
  const prevTrickRef = useRef<Combination | null>(null)
  const prevPassedCountRef = useRef<number>(0)
  const prevMyTurnRef = useRef<boolean>(false)
  const prevStatusRef = useRef<string | null>(null)

  useEffect(() => {
    if (!match) return
    const meSeat = match.seats.find((s) => s.userId === userId)
    const isMyTurnNow = match.status === 'PLAYING' && meSeat?.seat === match.currentSeat
    const trickKey = match.currentTrick ? match.currentTrick.cards.join(',') : null
    const prevTrick = prevTrickRef.current
    const prevTrickKey = prevTrick ? prevTrick.cards.join(',') : null

    const turnsOrder: SeatView[] = []
    const tCfg = { players: match.seats.length, direction: R.direction }
    if (meSeat) for (let s = seatAfter(meSeat.seat, tCfg); s !== meSeat.seat; s = seatAfter(s, tCfg)) turnsOrder.push(match.seats[s]!)
    else turnsOrder.push(...match.seats)

    if (prevVersionRef.current !== null && match.version !== prevVersionRef.current) {
      if (match.status === 'FINISHED' && prevStatusRef.current !== 'FINISHED') {
        const winSeat = match.winnerSeat !== null ? match.seats[match.winnerSeat] : null
        playSound(winSeat?.userId === userId ? 'win' : 'lose')
      } else if (trickKey && trickKey !== prevTrickKey) {
        playSound('play')
        // Detect Four-of-a-Kind chopping a single Deuce (2)
        if (prevTrick?.type === 'SINGLE' && prevTrick.keyRank === 15 && match.currentTrick?.type === 'FOUR_OF_A_KIND') {
          if (chopTimerRef.current !== null) window.clearTimeout(chopTimerRef.current)
          window.setTimeout(() => setChopBurst(true), 0)
          chopTimerRef.current = window.setTimeout(() => setChopBurst(false), 1050)
        }
      } else if (prevTrick && !match.currentTrick && match.status === 'PLAYING') {
        // Previous trick just cleared for a new round: sweep old cards toward winner (leadSeat)
        const vec = seatVectorOffset(match.leadSeat, meSeat?.seat, turnsOrder)
        if (sweepTimerRef.current !== null) window.clearTimeout(sweepTimerRef.current)
        window.setTimeout(
          () => setSweptTrick({ cards: prevTrick.cards, toX: vec.x, toY: vec.y, key: match.version }),
          0,
        )
        sweepTimerRef.current = window.setTimeout(() => setSweptTrick(null), 430)
      } else if (match.passedSeats.length > prevPassedCountRef.current) {
        playSound('pass')
      }

      if (isMyTurnNow && !prevMyTurnRef.current) {
        playSound('turn')
        try {
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(35)
          }
        } catch {
          // Ignore unsupported vibration
        }
      }
    }

    prevVersionRef.current = match.version
    prevTrickRef.current = match.currentTrick
    prevPassedCountRef.current = match.passedSeats.length
    prevMyTurnRef.current = isMyTurnNow
    prevStatusRef.current = match.status
  }, [match, userId])

  useEffect(() => {
    return () => {
      if (chopTimerRef.current !== null) window.clearTimeout(chopTimerRef.current)
      if (sweepTimerRef.current !== null) window.clearTimeout(sweepTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!playing || secondsLeft === null) return
    if (secondsLeft >= 1 && secondsLeft <= 5) {
      playSound('tick')
    }
  }, [playing, secondsLeft])

  // Round-robin deal target keys matching visual seats
  const dealSeatKeys = useMemo(() => {
    if (!match) return []
    const meSeat = match.seats.find((s) => s.userId === userId)
    const turns = { players: match.seats.length, direction: R.direction }
    const keys: string[] = []
    if (meSeat) {
      let oppIdx = 0
      for (let s = seatAfter(meSeat.seat, turns); s !== meSeat.seat; s = seatAfter(s, turns)) {
        keys.push(`opp-${oppIdx++}`)
      }
      keys.push('me')
    } else {
      for (let i = 0; i < match.seats.length; i++) keys.push(`opp-${i}`)
    }
    return keys
  }, [match, userId])

  if (load.state === 'loading')
    return (
      <div role="status" className="grid gap-4">
        <span className="sr-only">Đang tải bàn chơi…</span>
        <div className="casino-table-surface grid min-h-[34rem] gap-6 rounded-[2.5rem] border-[6px] border-wood-rim p-5 sm:p-8 lg:min-h-[42rem]">
          <div className="grid grid-cols-3 gap-4">
            <div className="h-20 animate-pulse rounded-xl bg-white/10" />
            <div className="h-20 animate-pulse rounded-xl bg-white/10" />
            <div className="h-20 animate-pulse rounded-xl bg-white/10" />
          </div>
          <div className="mx-auto h-36 w-72 animate-pulse rounded-full bg-white/10" />
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
  const myPoints = me && !me.isBot ? (typeof me.points === 'number' ? me.points : profilePoints) : undefined

  // Opponents in CCW order after me (or all seats if spectator)
  const order: SeatView[] = []
  const turns = { players: match.seats.length, direction: R.direction }
  if (me) for (let s = seatAfter(me.seat, turns); s !== me.seat; s = seatAfter(s, turns)) order.push(match.seats[s]!)
  else order.push(...match.seats)

  const trickOrigin = seatVectorOffset(match.leadSeat, me?.seat, order)

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

  const lastChatId = chat.messages.at(-1)?.id ?? 0
  const unread = chatOpen ? 0 : chat.messages.filter((m) => m.id > Math.max(seenChatId, chat.historyUpToId) && m.userId !== userId).length
  function toggleChat() {
    setSeenChatId(lastChatId)
    setScoresOpen(false)
    setChatOpen((o) => !o)
  }
  const chatPeople: Record<string, ChatPerson> = Object.fromEntries(
    match.seats.map((s) => [s.userId, { avatarId: s.avatarId, isBot: s.isBot }]),
  )
  const myBubble = me ? chat.bubbles[me.userId] : undefined

  const winner = match.winnerSeat !== null ? match.seats[match.winnerSeat] : null
  const turnName = match.seats[match.currentSeat]?.displayName

  // Visual positioning around the oval table while strictly preserving CCW DOM order in `order`.
  function seatPositionClass(idx: number, total: number): string {
    if (total === 1) {
      return 'mx-auto w-full max-w-[15rem] sm:max-w-[17rem]'
    }
    if (total === 2) {
      return idx === 0 ? 'col-start-2 row-start-1 lg:justify-self-end lg:w-60' : 'col-start-1 row-start-1 lg:justify-self-start lg:w-60'
    }
    if (total === 3) {
      // Top row Left (idx 2) - Center (idx 1) - Right (idx 0) on mobile & flanking the oval on desktop
      if (idx === 1) return 'col-start-2 row-start-1 w-full lg:max-w-[16rem] lg:justify-self-center'
      if (idx === 2) return 'col-start-1 row-start-1 w-full lg:max-w-[15rem] lg:justify-self-start lg:translate-y-24 lg:z-20'
      return 'col-start-3 row-start-1 w-full lg:max-w-[15rem] lg:justify-self-end lg:translate-y-24 lg:z-20'
    }
    if (total === 4) {
      // 5-player table (4 opponents): CCW arch Left (idx 3) · Top-Left (idx 2) · Top-Right (idx 1) · Right (idx 0)
      if (idx === 3) return 'col-start-1 row-start-1 w-full sm:col-start-1 sm:row-start-1 lg:translate-y-10 lg:z-20'
      if (idx === 2) return 'col-start-1 row-start-2 w-full sm:col-start-2 sm:row-start-1'
      if (idx === 1) return 'col-start-2 row-start-2 w-full sm:col-start-3 sm:row-start-1'
      return 'col-start-2 row-start-1 w-full sm:col-start-4 sm:row-start-1 lg:translate-y-10 lg:z-20'
    }
    return 'w-full'
  }
  // Phones held sideways: one flat row of compact seats, no desktop "arch" offsets.
  const landSeatClass = 'land:max-w-none land:translate-y-0 land:justify-self-stretch land:w-full'


  const actionsDisabled = pending || deal.dealing
  const resultDeltaByUser = new Map<string, { delta: number; wins: number }>()
  if (results && results.length > 0 && match.status === 'FINISHED') {
    for (const r of results) resultDeltaByUser.set(r.userId, { delta: r.scoreDelta, wins: r.isWinner ? 1 : 0 })
  }
  const scoreboardEntries: ScoreboardEntry[] = match.seats.map((s) => {
    const isMe = s.userId === userId
    const pts = !s.isBot ? (typeof s.points === 'number' ? s.points : isMe ? profilePoints : undefined) : undefined
    const fallback = resultDeltaByUser.get(s.userId)
    return {
      userId: s.userId,
      seat: s.seat,
      displayName: s.displayName,
      isBot: s.isBot,
      avatarId: s.avatarId,
      points: pts,
      roomDelta: s.roomDelta ?? fallback?.delta ?? 0,
      roomWins: s.roomWins ?? fallback?.wins ?? 0,
      cardCount: s.cardCount,
    }
  })

  return (
    <div className="grid min-w-0 gap-2.5">
      {/* Full-Size Grand Luxury Royal Casino Oval Table */}
      <div
        ref={tableRef}
        className={cn(
          'casino-table-surface relative flex min-h-[calc(100vh-4.75rem)] w-full flex-col justify-between gap-2.5 overflow-hidden rounded-[2rem] border-[6px] border-wood-rim p-3 ring-2 ring-gold/55 sm:gap-4 sm:rounded-[3.5rem] sm:border-[8px] sm:p-5 lg:min-h-[calc(100vh-5rem)] lg:rounded-[5.25rem] lg:border-[10px] lg:p-6',
          // Phone held sideways: exactly one screen tall, thin rim, tight spacing.
          'land:h-[100dvh] land:min-h-0 land:gap-1 land:rounded-[1.75rem] land:border-4 land:px-4 land:py-1.5',
          chopBurst && 'animate-table-shake',
        )}
      >
        {/* Corner Filigree Ornaments */}
        <span aria-hidden className="pointer-events-none absolute left-5 top-3 text-xs text-gold/35 select-none sm:text-sm land:hidden">
          ❖
        </span>
        <span aria-hidden className="pointer-events-none absolute right-5 top-3 text-xs text-gold/35 select-none sm:text-sm land:hidden">
          ❖
        </span>

        {/* Opening Deal Flight Overlay */}
        <CardFlightLayer
          dealing={deal.dealing}
          step={deal.step}
          totalSteps={deal.totalSteps}
          seatKeys={dealSeatKeys}
          tableRef={tableRef}
          targetRefs={targetRefs}
        />

        {/* Integrated Frosted-Glass Table Top HUD Bar */}
        <div className="z-20 flex flex-wrap items-center justify-between gap-2 rounded-full border border-gold/25 bg-black/45 px-3 py-1.5 backdrop-blur-md land:flex-nowrap land:py-0.5 land:whitespace-nowrap">
          <div className="flex items-center gap-2">
            <ConnectionBadge status={connection} />
            <span className="hidden rounded-full border border-gold/35 bg-white/8 px-2.5 py-0.5 text-xs font-semibold text-gold-light sm:inline-block land:hidden">
              {match.ranked ? '♠ Bàn VIP Tính Điểm' : '✦ Bàn Luyện Tập'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {!finished && secondsLeft !== null && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums shadow-2xs sm:px-3 sm:text-sm',
                  secondsLeft <= 5
                    ? 'animate-urgent-ring bg-suit-red text-white ring-1 ring-red-300'
                    : myTurn
                      ? 'bg-gradient-to-r from-gold-shine via-gold-light to-gold text-wood-dark ring-1 ring-gold-bright'
                      : 'border border-gold/30 bg-black/45 text-ivory',
                )}
              >
                <span aria-hidden className={cn('size-1.5 rounded-full', secondsLeft <= 5 ? 'bg-white' : 'bg-wood-dark')} />
                {myTurn ? 'Bạn' : turnName} còn {secondsLeft}s
              </span>
            )}
            <button
              type="button"
              aria-expanded={chatOpen}
              aria-label={unread > 0 ? `Trò chuyện (${unread} tin mới)` : 'Trò chuyện'}
              onClick={toggleChat}
              className={cn(
                'relative inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none',
                chatOpen
                  ? 'border-gold bg-gold/20 text-gold-light'
                  : 'border-white/15 bg-white/8 text-ivory/85 hover:border-gold/50 hover:text-gold-light',
              )}
            >
              <span aria-hidden>💬</span>
              <span className="hidden sm:inline land:hidden">Chat</span>
              {unread > 0 && (
                <span
                  aria-hidden
                  className="absolute -top-1.5 -right-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-suit-red px-1 text-[10px] font-bold text-white"
                >
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </button>
            {/* Phone landscape only: the in-table scoreboard is folded into a pop-over */}
            <button
              type="button"
              aria-expanded={scoresOpen}
              aria-label="Bảng điểm"
              onClick={() => {
                setChatOpen(false)
                setScoresOpen((o) => !o)
              }}
              className={cn(
                'hidden cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none land:inline-flex',
                scoresOpen
                  ? 'border-gold bg-gold/20 text-gold-light'
                  : 'border-white/15 bg-white/8 text-ivory/85 hover:border-gold/50 hover:text-gold-light',
              )}
            >
              <span aria-hidden>🏆</span>
            </button>
            {fullscreenSupported && (
              <button
                type="button"
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
                title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
                  else void enterLandscapeFullscreen()
                }}
                className="hidden cursor-pointer items-center rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 text-xs font-medium text-ivory/85 transition-colors hover:border-gold/50 hover:text-gold-light focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none land:inline-flex"
              >
                <span aria-hidden>{isFullscreen ? '⤡' : '⤢'}</span>
              </button>
            )}
            <Link
              to={`/room/${match.roomId}`}
              className="rounded-full border border-white/15 bg-white/8 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-ivory/85 transition-colors hover:border-gold/50 hover:text-gold-light"
            >
              Phòng chờ
            </Link>
          </div>
        </div>

        {scoresOpen && (
          <div className="absolute top-10 right-4 z-40 hidden w-60 land:block">
            <RoomScoreboard
              entries={scoreboardEntries}
              currentUserId={userId}
              tone="dark"
              className="max-h-[calc(100dvh-4rem)] overflow-y-auto bg-black/80 shadow-2xl"
            />
          </div>
        )}

        {chatOpen && (
          <ChatPanel
            tone="dark"
            className="absolute top-14 right-3 left-3 z-40 h-[25rem] max-h-[calc(100%-4.5rem)] shadow-2xl sm:left-auto sm:w-[22rem] land:top-10 land:max-h-[calc(100%-3rem)]"
            messages={chat.messages}
            meId={userId}
            people={chatPeople}
            sending={chat.sending}
            error={chat.error}
            onSendText={chat.sendText}
            onSendEmote={(code) => void chat.sendEmote(code)}
            headerExtra={
              <button
                type="button"
                aria-label="Đóng trò chuyện"
                onClick={toggleChat}
                className="inline-flex size-7 cursor-pointer items-center justify-center rounded-full text-ivory/70 hover:bg-white/10 hover:text-ivory focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
              >
                <span aria-hidden>✕</span>
              </button>
            }
          />
        )}

        {/* Opponents seated around the oval table */}
        <ol
          className={cn(
            'z-10 grid gap-1.5 sm:gap-3 lg:px-4 land:gap-2 land:px-6',
            order.length === 3
              ? 'grid-cols-3'
              : order.length === 2
                ? 'grid-cols-2'
                : order.length >= 4
                  ? 'grid-cols-2 sm:grid-cols-4'
                  : 'grid-cols-1',
            order.length === 2 && 'land:mx-auto land:w-full land:max-w-xl',
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
              bubble={chat.bubbles[s.userId]}
              className={cn(seatPositionClass(idx, order.length), landSeatClass)}
              seatRef={(el) => {
                targetRefs.current.set(`opp-${idx}`, el)
              }}
            />
          ))}
        </ol>

        {/* Center Oval Felt Arena (`Bài trên bàn`) */}
        <section
          aria-label="Bài trên bàn"
          className={cn(
            'casino-felt-ring relative z-10 flex min-h-56 flex-1 flex-col items-center justify-center gap-2.5 rounded-[2rem] bg-felt-dark/35 px-3 py-4 sm:min-h-72 sm:rounded-[4rem] sm:px-56 lg:min-h-[18.5rem] lg:rounded-[9999px] lg:px-64',
            'land:min-h-0 land:flex-row land:flex-wrap land:content-center land:gap-x-4 land:gap-y-1 land:overflow-hidden land:rounded-[9999px] land:px-6 land:py-1',
          )}
        >
          {/* Ornate Center Casino Crest Watermark */}
          <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center select-none land:hidden">
            <div className="flex flex-col items-center justify-center rounded-full border border-gold/14 px-8 py-5 sm:px-12 sm:py-7">
              <span className="font-display text-xs tracking-[0.35em] text-gold-light/18 uppercase sm:text-base">
                ♠ Xâm Online ♠
              </span>
              <span className="mt-1 text-[10px] tracking-[0.22em] text-gold-light/12 uppercase">
                Royal Casino Club
              </span>
            </div>
          </div>

          {/* CHẶT! Four-of-a-Kind Chops Deuce Burst */}
          <ChopBurst show={chopBurst} />

          {/* Swept Outgoing Trick (brief motion toward round winner) */}
          {sweptTrick && (
            <div
              key={`sweep-${sweptTrick.key}`}
              aria-hidden
              style={
                {
                  '--sweep-x': sweptTrick.toX,
                  '--sweep-y': sweptTrick.toY,
                } as CSSProperties
              }
              className="animate-trick-sweep pointer-events-none absolute z-10 flex gap-1.5"
            >
              {parseCards(sweptTrick.cards).map((c) => (
                <PlayingCard key={c.code} card={c} className="shadow-xl" />
              ))}
            </div>
          )}

          {/* Active Báo Xâm Alert (Frosted Glass) */}
          {samPlayer && !finished && (
            <div className="z-10 flex items-center gap-2 rounded-full border border-gold/80 bg-suit-red-dark/80 px-3.5 py-1 text-center text-xs font-bold text-gold-shine shadow-lg backdrop-blur-md sm:text-sm">
              <span aria-hidden>🔥</span>
              <span>
                {samPlayer.userId === userId ? 'Bạn' : samPlayer.displayName} đã <strong>BÁO XÂM</strong> (đi trước · ai chặn được thắng ngay!)
              </span>
            </div>
          )}

          {/* Center Played Trick or New Round Notice */}
          {match.currentTrick ? (
            <div key={match.version} className="z-10 grid justify-items-center gap-2.5 land:flex land:items-center land:gap-3">
              <p className="rounded-full border border-gold/45 bg-black/50 px-3.5 py-1 text-xs font-semibold text-gold-light shadow-md backdrop-blur-md sm:text-sm">
                {match.seats[match.leadSeat]?.displayName} · {COMBINATION_LABEL[match.currentTrick.type]}
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
                {parseCards(match.currentTrick.cards).map((c) => (
                  <PlayingCard
                    key={`${match.version}-${c.code}`}
                    card={c}
                    style={
                      {
                        '--from-x': trickOrigin.x,
                        '--from-y': trickOrigin.y,
                        '--tilt': `${cardTiltDeg(c.code)}deg`,
                      } as CSSProperties
                    }
                    className="animate-card-play shadow-2xl"
                  />
                ))}
              </div>
            </div>
          ) : (
            !finished && (
              <div key={`round-${match.leadSeat}-${match.version}`} className="animate-round-new z-10 grid justify-items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-flex size-8 items-center justify-center rounded-full border border-gold/40 bg-black/40 text-sm text-gold-light backdrop-blur-md"
                >
                  ✦
                </span>
                <p className="rounded-full border border-gold/45 bg-black/50 px-4 py-1 text-center text-xs font-semibold text-ivory shadow-md backdrop-blur-md sm:text-sm">
                  Vòng mới · {turnName} đánh trước
                </p>
              </div>
            )
          )}

          {/* Centered Frosted-Glass Turn / Combination / Thối 2 Warning / Error Pill */}
          {me && !finished && (
            <div className="z-10 mt-0.5 flex flex-col items-center gap-1.5 land:mt-0 land:max-w-[15rem]">
              <p
                className={cn(
                  'rounded-full border px-3.5 py-1 text-center text-xs font-semibold shadow-sm backdrop-blur-md transition-all sm:px-4 sm:text-sm',
                  isLastPlayTwoWarning
                    ? 'border-red-400/80 bg-red-950/80 font-bold text-red-100'
                    : selected.length > 0
                      ? hint
                        ? 'border-gold/70 bg-black/55 text-gold-light'
                        : 'border-red-400/65 bg-red-950/70 text-red-100'
                      : myTurn
                        ? 'border-gold/45 bg-black/50 text-gold-light'
                        : 'border-white/15 bg-black/35 text-ivory/85',
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
                  className="rounded-full border border-red-400/65 bg-red-950/85 px-4 py-1 text-center text-xs font-semibold text-red-100 shadow-md backdrop-blur-md sm:text-sm"
                >
                  {error}
                </p>
              )}
            </div>
          )}

          {/* Centered Spectator Banner */}
          {!me && !finished && (
            <p
              role="status"
              className="z-10 max-w-md rounded-2xl border border-gold/45 bg-black/55 px-5 py-3 text-center text-sm font-medium text-ivory shadow-lg backdrop-blur-md"
            >
              Bạn đang xem ván này. Bạn sẽ được vào chơi từ ván sau khi có ghế trống.
            </p>
          )}

          {/* In-Table Left History & Right Scoreboard HUD Panels */}
          <div className="z-20 mt-1 grid w-full min-w-0 gap-2 sm:contents land:hidden">
            {/* Compact Left-Corner Frosted-Glass Match History */}
            <aside
              aria-label="Diễn biến ván"
              className="casino-glass-panel z-20 flex max-h-24 w-full flex-col rounded-xl border border-gold/25 p-2 text-[11px] text-ivory/85 shadow-md sm:absolute sm:bottom-3 sm:left-4 sm:max-h-32 sm:w-48"
            >
              <div className="mb-1 flex items-center justify-between border-b border-gold/15 pb-0.5">
                <span className="font-display text-[10px] font-bold tracking-wider text-gold-light/90 uppercase">
                  📜 Diễn biến
                </span>
                <span className="rounded-full bg-white/10 px-1.5 text-[9px] font-semibold tabular-nums text-ivory/75">
                  #{match.version}
                </span>
              </div>

              {actionLog.length === 0 ? (
                <p className="my-auto text-center text-[10px] text-ivory/50">Ván mới…</p>
              ) : (
                <ul className="grid gap-1 overflow-y-auto pr-0.5">
                  {actionLog.slice(0, 6).map((item) => {
                    const seatName =
                      item.seat !== null ? (match.seats[item.seat]?.displayName ?? `Ghế ${item.seat + 1}`) : 'Bàn'
                    return (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-1 rounded bg-white/5 px-1.5 py-0.5 leading-tight"
                      >
                        <span className="max-w-20 truncate font-semibold text-gold-light/95">{seatName}</span>
                        {item.kind === 'PLAY' && item.cards ? (
                          <MiniCardChips cards={item.cards} />
                        ) : item.kind === 'PASS' ? (
                          <span className="text-[10px] text-ivory/65">Bỏ lượt</span>
                        ) : item.kind === 'DECLARE_SAM' ? (
                          <span className="rounded bg-suit-red px-1 text-[10px] font-bold text-gold-light">🔥 Báo Xâm</span>
                        ) : item.kind === 'ROUND_RESET' ? (
                          <span className="text-[10px] text-emerald-300">✦ Vòng mới</span>
                        ) : (
                          <span className="text-[10px] text-ivory/60">Chia bài</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </aside>

            {/* Right-Corner In-Table Frosted-Glass Leaderboard (1–5) */}
            <RoomScoreboard
              entries={scoreboardEntries}
              currentUserId={userId}
              tone="dark"
              className="z-20 w-full sm:absolute sm:right-4 sm:bottom-3 sm:max-h-[17.5rem] sm:w-56 sm:overflow-y-auto lg:w-64"
            />
          </div>
        </section>

        {/* My Seat & Hand Dock at the Bottom of the Table */}
        {me && !finished && (
          <section
            ref={(el) => {
              targetRefs.current.set('me', el)
            }}
            aria-label="Bài của bạn"
            className={cn(
              'casino-glass-panel relative z-10 grid gap-2 rounded-2xl border px-2 py-2.5 transition-all sm:gap-2.5 sm:p-4',
              // Phone landscape: hand on the left, status + buttons stacked on the right.
              'land:grid-cols-[minmax(0,1fr)_17rem] land:grid-rows-[auto_auto_1fr] land:gap-x-3 land:gap-y-1 land:px-3 land:py-1.5',
              myTurn ? 'animate-turn-seat border-gold-light bg-black/55' : 'border-white/15',
            )}
          >
            {/* My Seat Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-sm land:col-start-2 land:row-start-2 land:gap-1.5 land:px-0 land:text-xs">
              <div className="flex flex-wrap items-center gap-2 land:gap-1.5">
                <span className="relative">
                  <Avatar
                    avatarId={me.avatarId}
                    name={me.displayName}
                    className={cn(
                      'size-9 text-xs font-extrabold shadow-inner ring-2 land:size-7',
                      myTurn ? 'ring-gold-shine' : 'ring-gold/45',
                    )}
                    fallbackClassName={myTurn ? 'bg-gold text-wood-dark' : 'bg-felt text-gold-light'}
                  />
                  {myBubble && (
                    <EmoteBubble key={myBubble.key} code={myBubble.code} name="Bạn" className="bottom-11 left-0" />
                  )}
                </span>
                <span className={cn('font-bold', myTurn ? 'text-gold-light' : 'text-ivory/85')}>
                  {myTurn ? 'Đến lượt bạn' : `Chờ ${turnName}…`}
                </span>
                {typeof myPoints === 'number' && (
                  <span className="casino-chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold tabular-nums text-wood-dark land:hidden">
                    <span aria-hidden className="text-[9px]">
                      ●
                    </span>
                    {myPoints} điểm
                  </span>
                )}
                {match.samSeat === me.seat && (
                  <span className="rounded-full border border-gold bg-suit-red px-2.5 py-0.5 text-xs font-bold text-gold-light shadow-2xs">
                    🔥 Đang Báo Xâm
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="relative">
                  <button
                    type="button"
                    aria-expanded={emotesOpen}
                    aria-label="Biểu cảm"
                    title="Gửi biểu cảm"
                    onClick={() => setEmotesOpen((o) => !o)}
                    className={cn(
                      'inline-flex size-8 cursor-pointer items-center justify-center rounded-full border text-base transition-colors focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none',
                      emotesOpen ? 'border-gold bg-gold/25' : 'border-gold/35 bg-black/50 hover:border-gold',
                    )}
                  >
                    <span aria-hidden>😊</span>
                  </button>
                  {emotesOpen && (
                    <EmoteBar
                      tone="dark"
                      disabled={chat.sending}
                      onPick={(code) => {
                        setEmotesOpen(false)
                        void chat.sendEmote(code)
                      }}
                      className="absolute right-0 bottom-10 z-40 w-[13.5rem] rounded-2xl border border-gold/40 bg-black/85 p-2 shadow-xl backdrop-blur-md"
                    />
                  )}
                </span>
                {hand.length === 1 && (
                  <span className="animate-bao1-pulse rounded-full bg-suit-red px-2.5 py-0.5 text-xs font-bold text-white shadow-2xs">
                    🔥 Báo 1
                  </span>
                )}
                <span className="rounded-full border border-gold/40 bg-black/50 px-3 py-0.5 text-xs font-bold tabular-nums text-gold-light">
                  {hand.length} lá
                </span>
              </div>
            </div>

            {/* 30s turn progress bar */}
            {myTurn && secondsLeft !== null && (
              <div className="mx-1 h-1.5 overflow-hidden rounded-full bg-white/12 land:col-span-2 land:row-start-1 land:h-1" aria-hidden>
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-300',
                    secondsLeft <= 5 ? 'bg-suit-red' : 'bg-gradient-to-r from-gold-dark via-gold to-gold-shine',
                  )}
                  style={{ width: `${Math.min(100, Math.max(0, (secondsLeft / TURN_SECONDS_MAX) * 100))}%` }}
                />
              </div>
            )}

            {/* Player Hand (fanned on desktop, compact stack on mobile) */}
            <div className="min-w-0 land:col-start-1 land:row-span-2 land:row-start-2 land:self-center">
              <Hand cards={hand} disabled={pending} />
            </div>

            {/* Action Controls */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5 sm:justify-between sm:gap-2.5 land:col-start-2 land:row-start-3 land:flex-nowrap land:content-end land:justify-start land:gap-1.5 land:pt-0">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 land:flex-nowrap land:justify-start land:gap-1.5">
                <Button
                  variant="gold"
                  size="lg"
                  disabled={!myTurn || actionsDisabled || !hint}
                  onClick={() => void act('play')}
                  className="h-11 min-w-32 px-7 text-base font-extrabold shadow-[0_6px_18px_rgba(212,160,23,0.4)] land:h-9 land:min-w-24 land:px-4"
                >
                  Đánh
                </Button>
                <Button
                  variant="outline"
                  disabled={!myTurn || actionsDisabled || leading}
                  onClick={() => void act('pass')}
                  className="h-11 border-gold/45 bg-felt-dark/85 px-5 font-bold text-ivory hover:border-gold hover:bg-felt-dark land:h-9 land:px-3.5"
                >
                  Bỏ lượt
                </Button>
                {canDeclareSam && (
                  <button
                    type="button"
                    disabled={actionsDisabled}
                    onClick={() => void act('sam')}
                    title="Báo Xâm: Xin đi trước và đánh hết bài không ai chặn được (nếu bị chặn sẽ xử thua)"
                    className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gold-bright land:h-9 land:px-3 bg-gradient-to-b from-ruby-fire to-suit-red-dark px-5 py-2 text-sm font-extrabold text-gold-shine shadow-(--shadow-fire-glow) transition-all hover:brightness-110 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
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
                    className="text-ivory/60 hover:bg-white/10 hover:text-ivory land:h-9 land:px-2"
                    onClick={() => setConfirmAbort(true)}
                  >
                    Huỷ ván…
                  </Button>
                ))}
            </div>
          </section>
        )}

        {/* Centered Frosted-Glass Match Results Modal */}
        {finished && (
          <ResultsModal
            match={match}
            me={me}
            winner={winner}
            foulPlayer={foulPlayer}
            results={results}
            userId={userId}
            startingNext={startingNext}
            error={error}
            onContinue={() => void onContinueNextMatch()}
          />
        )}
      </div>

      {/* Phones held upright: ask to rotate (the table keeps running underneath) */}
      <RotateDeviceHint
        backTo={`/room/${match.roomId}`}
        notice={myTurn && secondsLeft !== null ? `Đến lượt bạn · còn ${secondsLeft}s` : null}
      />
    </div>
  )
}
