import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConnectionBadge } from '@/components/ConnectionBadge'
import { Avatar } from '@/components/Avatar'
import { ChatPanel, type ChatPerson } from '@/components/chat/ChatPanel'
import { EmoteBubble } from '@/components/chat/EmoteBubble'
import { RoomScoreboard } from '@/features/game/components/RoomScoreboard'
import { useRoomChat } from '@/features/chat/useRoomChat'
import { useAuthStore } from '@/features/auth/store'
import { startMatch } from '@/features/match/api'
import { addBot, fetchRoom, leaveRoom, removeBot, type RoomPlayer, type RoomView } from '@/features/rooms/api'
import { ApiCallError } from '@/lib/functions'
import { useTopic } from '@/lib/realtime'
import { playSound } from '@/lib/sound'
import { cn } from '@/lib/utils'

/** Ruleset xam-baseline v2 (R01b, R34): at least 2 seated players; 10 points for a ranked match. */
const MIN_PLAYERS = 2
const MIN_POINTS = 10

type Load = { state: 'loading' } | { state: 'error' } | { state: 'gone' } | { state: 'ready'; room: RoomView }

export function WaitingRoomPage() {
  const { roomId = '' } = useParams()
  const userId = useAuthStore((s) => s.session?.user.id)
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState<'start' | 'leave' | 'bot' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const chat = useRoomChat(roomId || null)

  const apply = useCallback(
    (room: RoomView | null | 'error') => {
      if (room === 'error') return setLoad({ state: 'error' })
      if (!room || room.status === 'CLOSED') return setLoad({ state: 'gone' })
      if (room.status === 'PLAYING' && room.currentMatchId) return navigate(`/match/${room.currentMatchId}`)
      setLoad({ state: 'ready', room })
    },
    [navigate],
  )
  const fetchState = useCallback(() => fetchRoom(roomId).catch(() => 'error' as const), [roomId])
  const refresh = useCallback(() => fetchState().then(apply), [fetchState, apply])

  useEffect(() => {
    let cancelled = false
    void fetchState().then((room) => {
      if (!cancelled) apply(room)
    })
    return () => {
      cancelled = true
    }
  }, [fetchState, apply])

  const { status: connection, online } = useTopic(
    roomId ? `room:${roomId}` : null,
    (event, payload) => {
      if (event === 'chat') chat.receive(payload)
      else if (event === 'match_started' && typeof payload.matchId === 'string') navigate(`/match/${payload.matchId}`)
      else void refresh()
    },
    () => {
      void refresh()
      chat.reload()
    },
    { presenceKey: userId },
  )

  async function run(kind: 'start' | 'leave' | 'addBot' | { removeBot: string }) {
    setBusy(typeof kind === 'object' || kind === 'addBot' ? 'bot' : kind)
    setError(null)
    try {
      if (kind === 'start') {
        playSound('deal')
        const { matchId } = await startMatch(roomId)
        navigate(`/match/${matchId}`)
        return
      }
      if (kind === 'leave') {
        await leaveRoom(roomId)
        navigate('/')
        return
      }
      if (kind === 'addBot') {
        playSound('select')
        await addBot(roomId)
      } else {
        await removeBot(roomId, kind.removeBot)
      }
      setBusy(null)
      void refresh()
    } catch (e) {
      setError(e instanceof ApiCallError ? e.message : 'Có lỗi xảy ra, vui lòng thử lại')
      setBusy(null)
      void refresh()
    }
  }

  if (load.state === 'loading')
    return (
      <div role="status" className="grid gap-6">
        <span className="sr-only">Đang tải…</span>
        <div className="h-44 animate-pulse rounded-2xl border border-card-border bg-ivory p-6" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
        </div>
      </div>
    )
  if (load.state === 'error')
    return (
      <p role="alert" className="rounded-xl border border-suit-red/30 bg-red-50 p-4 text-sm font-medium text-suit-red">
        Không tải được phòng. Vui lòng tải lại trang.
      </p>
    )
  if (load.state === 'gone')
    return (
      <div className="grid justify-items-center gap-4 rounded-2xl border border-card-border bg-ivory p-8 text-center shadow-xs">
        <p className="text-slate-700">Phòng không tồn tại hoặc bạn không còn ở trong phòng này.</p>
        <Button asChild variant="outline" className="w-fit">
          <Link to="/">Về sảnh</Link>
        </Button>
      </div>
    )

  const { room } = load
  const isHost = room.hostId === userId
  const count = room.players.length
  const canStart = count >= MIN_PLAYERS
  const hasBot = room.players.some((p) => p.isBot)
  const lowPoints = hasBot ? [] : room.players.filter((p) => p.points < MIN_POINTS)
  const iAmWaiting = room.waiting.some((p) => p.userId === userId)
  const canTriggerStart = isHost || (room.currentMatchId !== null && !iAmWaiting)
  const seats = [0, 1, 2, 3, 4].map((seat) => room.players.find((p) => p.seat === seat) ?? null)
  const isOnline = (p: RoomPlayer) => p.isBot || online.has(p.userId)
  const people: Record<string, ChatPerson> = Object.fromEntries(
    [...room.players, ...room.waiting].map((p) => [p.userId, { avatarId: p.avatarId, isBot: p.isBot }]),
  )
  const scoreboardEntries = room.players.map((p, idx) => ({
    userId: p.userId,
    seat: p.seat ?? idx,
    displayName: p.displayName,
    isBot: p.isBot,
    avatarId: p.avatarId,
    points: p.points,
    roomDelta: p.roomDelta ?? 0,
    roomWins: p.roomWins ?? 0,
  }))

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code)
      playSound('select')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: the code is on screen anyway
    }
  }

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_17.5rem] lg:items-start">
      <div className="grid min-w-0 gap-6">
        {/* Luxury Casino Ticket Header Card */}
        <Card className="overflow-hidden border-gold/45 bg-gradient-to-br from-felt-dark via-felt to-felt-dark text-ivory shadow-lg">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-2xl text-gold-light">Phòng chờ</CardTitle>
              <ConnectionBadge status={connection} />
            </div>
            <CardDescription className="text-ivory/80">
              Gửi mã phòng cho bạn bè. Cần ít nhất 2 người chơi (có thể thêm máy); tối đa 5 người ngồi chơi, người vào
              sau sẽ chờ ván tiếp theo.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 border-t border-gold/20 bg-felt-deep/45 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2.5 rounded-xl border-2 border-dashed border-gold/70 bg-felt-deep/90 px-4 py-2 shadow-inner">
                <span aria-hidden className="text-xs font-semibold tracking-wider text-gold-light/70 uppercase">
                  MÃ
                </span>
                <span
                  className="font-mono text-2xl font-extrabold tracking-[0.28em] text-gold-light sm:text-3xl"
                  aria-label={`Mã phòng ${room.code.split('').join(' ')}`}
                >
                  {room.code}
                </span>
              </div>
              <Button
                variant="gold"
                size="sm"
                onClick={() => void copyCode()}
                className="h-9 px-3.5 font-bold"
              >
                {copied ? 'Đã chép' : 'Chép mã'}
              </Button>
            </div>

            <span className="rounded-full border border-gold/30 bg-white/10 px-3 py-1 text-xs font-medium text-gold-light">
              {count}/5 ghế đã có người
            </span>
          </CardContent>
        </Card>

        {/* 5 Casino Seats Around Mini Oval Felt Table */}
        <div className="casino-table-surface relative overflow-hidden rounded-[2rem] border-[5px] border-wood-rim p-3.5 ring-2 ring-gold/50 sm:rounded-[3rem] sm:p-6">
          {/* Decorative Mini Oval Felt Ring Centerpiece (visible sm+) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-12 inset-y-8 hidden items-center justify-center rounded-full border border-gold/25 bg-felt-dark/30 sm:flex"
          >
            <span className="font-display text-xs tracking-[0.28em] text-gold-light/25 uppercase">
              ♠ Xâm Online · Bàn 5 Chỗ ♠
            </span>
          </div>

          <ol className="relative z-10 grid gap-3 sm:grid-cols-2 sm:gap-x-8 sm:gap-y-5" aria-label="Chỗ ngồi">
            {seats.map((p, seat) => {
              const seatIsHost = p?.userId === room.hostId
              const seatIsMe = p?.userId === userId
              const seatLow = p && !p.isBot && p.points < MIN_POINTS && !hasBot
              return (
                <li
                  key={seat}
                  className={cn(
                    'relative flex items-center justify-between gap-3 rounded-2xl border p-3.5 shadow-md transition-all sm:p-4',
                    seat === 4 && 'sm:col-span-2 sm:mx-auto sm:w-full sm:max-w-md',
                    p
                      ? seatIsMe
                        ? 'border-gold-light bg-ivory/95 ring-2 ring-gold/50'
                        : 'border-gold/35 bg-ivory/95'
                      : 'border-dashed border-gold/35 bg-black/30 text-ivory/75 backdrop-blur-xs',
                  )}
                >
                <div className="flex min-w-0 items-center gap-3">
                  {/* Seat Avatar */}
                  <div aria-hidden className="relative shrink-0">
                    {p ? (
                      <Avatar
                        avatarId={p.avatarId}
                        isBot={p.isBot}
                        userId={p.userId}
                        name={p.displayName}
                        className={cn('size-11 text-sm shadow-inner ring-2', seatIsHost ? 'ring-gold' : 'ring-gold/45')}
                        fallbackClassName={
                          seatIsHost ? 'bg-gradient-to-b from-gold-light to-gold text-wood-dark' : 'bg-felt text-ivory'
                        }
                      />
                    ) : (
                      <span className="flex size-11 items-center justify-center rounded-full border border-dashed border-gold/45 bg-black/25 text-sm font-bold text-gold-light/70">
                        {seat + 1}
                      </span>
                    )}
                    {seatIsHost && (
                      <span
                        title="Chủ phòng"
                        className="absolute -right-1 -top-1.5 flex size-5 items-center justify-center rounded-full bg-gold-shine text-xs shadow ring-1 ring-gold"
                      >
                        👑
                      </span>
                    )}
                  </div>

                  {/* Seat Label & Player Info */}
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-xs font-medium', p ? 'text-slate-500' : 'text-gold-light/65')}>
                        Ghế {seat + 1}
                      </span>
                      {p && (
                        <span
                          aria-label={isOnline(p) ? 'Đang online' : 'Mất kết nối'}
                          title={isOnline(p) ? 'Đang online' : 'Mất kết nối'}
                          className={cn(
                            'inline-block size-2 rounded-full',
                            isOnline(p) ? 'bg-emerald-500' : 'bg-slate-300',
                          )}
                        />
                      )}
                    </div>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={cn('truncate font-semibold', p ? 'text-slate-900' : 'text-ivory/60 italic')}>
                        {p ? `${p.isBot ? '🤖 ' : ''}${p.displayName}` : 'Trống'}
                      </span>
                      {p && !p.isBot && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-xs font-bold tabular-nums',
                            seatLow
                              ? 'bg-red-100 text-suit-red ring-1 ring-suit-red/30'
                              : 'casino-chip text-wood-dark',
                          )}
                        >
                          <span aria-hidden className="text-[8px]">
                            ●
                          </span>
                          {p.points} điểm
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-500">
                  <span className="rounded-md bg-cream-dark/80 px-2 py-0.5 text-slate-700 empty:hidden">
                    {[seatIsHost && 'Chủ phòng', seatIsMe && 'Bạn', p?.isBot && 'Máy'].filter(Boolean).join(' · ')}
                  </span>
                  {p?.isBot && isHost && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-xs text-slate-600 hover:border-suit-red hover:text-suit-red"
                      disabled={busy !== null}
                      aria-label={`Bỏ ${p.displayName}`}
                      onClick={() => void run({ removeBot: p.userId })}
                    >
                      Bỏ
                    </Button>
                  )}
                </span>
                {p && chat.bubbles[p.userId] && (
                  <EmoteBubble
                    key={chat.bubbles[p.userId]!.key}
                    code={chat.bubbles[p.userId]!.code}
                    name={p.displayName}
                    className="-top-6 left-12"
                  />
                )}
              </li>
            )
          })}
        </ol>
      </div>

      {/* Waiting Queue Section */}
      {room.waiting.length > 0 && (
        <section
          aria-label="Hàng chờ"
          className="grid gap-2.5 rounded-2xl border border-card-border bg-ivory p-4 shadow-2xs"
        >
          <h3 className="text-sm font-semibold text-slate-800">Hàng chờ ({room.waiting.length})</h3>
          <ol className="flex flex-wrap gap-2">
            {room.waiting.map((p, i) => (
              <li
                key={p.userId}
                className="relative inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-cream py-0.5 pr-3.5 pl-0.5 text-sm font-medium text-slate-800"
              >
                <Avatar avatarId={p.avatarId} userId={p.userId} name={p.displayName} className="size-6 text-[10px]" />
                {i + 1}. {p.displayName}
                {p.userId === userId && ' (bạn)'}
                {chat.bubbles[p.userId] && (
                  <EmoteBubble
                    key={chat.bubbles[p.userId]!.key}
                    code={chat.bubbles[p.userId]!.code}
                    name={p.displayName}
                    className="-top-9 left-0"
                  />
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">Người chờ sẽ được xếp vào ghế trống khi ván hiện tại kết thúc.</p>
        </section>
      )}

      {/* Mode / Eligibility Banner */}
      {canStart && (
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm',
            hasBot
              ? 'border-gold/50 bg-amber-50/90 text-amber-950'
              : lowPoints.length > 0
                ? 'border-suit-red/40 bg-red-50 text-suit-red'
                : 'border-felt/30 bg-emerald-50/80 text-felt-dark',
          )}
        >
          {hasBot ? (
            <p>
              ✦ Ván có máy là <strong>ván luyện tập</strong>: không cộng/trừ điểm và không ghi vào lịch sử.
            </p>
          ) : lowPoints.length > 0 ? (
            <p className="font-medium text-suit-red" role="alert">
              ⚠ Mỗi người cần ít nhất {MIN_POINTS} điểm để chơi ván tính điểm. Chưa đủ:{' '}
              {lowPoints.map((p) => p.displayName).join(', ')}.
            </p>
          ) : (
            <p className="font-medium">
              ♠ Ván tính điểm: người thua trả 1 điểm/lá (cóng 15), tối đa bằng số điểm đang có.
            </p>
          )}
        </div>
      )}

      {/* Room Controls */}
      <div className="flex flex-wrap items-center gap-3">
        {canTriggerStart ? (
          <>
            <Button
              variant={canStart && lowPoints.length === 0 ? 'gold' : 'default'}
              disabled={!canStart || busy !== null || lowPoints.length > 0}
              onClick={() => void run('start')}
              className="font-bold"
            >
              {busy === 'start' ? 'Đang chia bài…' : canStart ? `Bắt đầu ván (${count} người)` : 'Cần ít nhất 2 người'}
            </Button>
            {isHost && count < 5 && (
              <Button variant="outline" disabled={busy !== null} onClick={() => void run('addBot')}>
                {busy === 'bot' ? 'Đang thêm…' : 'Thêm máy'}
              </Button>
            )}
          </>
        ) : (
          <p className="rounded-lg bg-cream-dark/60 px-3 py-2 text-sm font-medium text-slate-700" role="status">
            {iAmWaiting
              ? 'Bạn đang trong hàng chờ, sẽ được vào ghế khi có chỗ trống.'
              : canStart
                ? 'Đang chờ chủ phòng bắt đầu…'
                : `Đang chờ thêm người (${count}/5)`}
          </p>
        )}
        <Button variant="outline" disabled={busy !== null} onClick={() => void run('leave')}>
          {busy === 'leave' ? 'Đang rời…' : 'Rời phòng'}
        </Button>
        {room.currentMatchId && (
          <Link to={`/match/${room.currentMatchId}`} className="text-sm font-medium text-felt underline">
            Xem ván vừa chơi
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-suit-red/30 bg-red-50 px-3 py-2 text-sm text-suit-red">
          {error}
        </p>
      )}

      <ChatPanel
        className="h-80"
        messages={chat.messages}
        meId={userId}
        people={people}
        sending={chat.sending}
        error={chat.error}
        onSendText={chat.sendText}
        onSendEmote={(code) => void chat.sendEmote(code)}
      />
      </div>

      {/* Right-hand Room Leaderboard (Top 1–5) */}
      <RoomScoreboard entries={scoreboardEntries} currentUserId={userId} tone="light" className="lg:sticky lg:top-4" />
    </div>
  )
}
