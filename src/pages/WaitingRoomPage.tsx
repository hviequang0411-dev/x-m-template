import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConnectionBadge } from '@/components/ConnectionBadge'
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

function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0]!.toUpperCase() : '?'
}

export function WaitingRoomPage() {
  const { roomId = '' } = useParams()
  const userId = useAuthStore((s) => s.session?.user.id)
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState<'start' | 'leave' | 'bot' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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
      if (event === 'match_started' && typeof payload.matchId === 'string') navigate(`/match/${payload.matchId}`)
      else void refresh()
    },
    () => void refresh(),
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
  const seats = [0, 1, 2, 3].map((seat) => room.players.find((p) => p.seat === seat) ?? null)
  const isOnline = (p: RoomPlayer) => p.isBot || online.has(p.userId)

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
    <div className="grid gap-6">
      {/* Luxury Casino Ticket Header Card */}
      <Card className="overflow-hidden border-gold/45 bg-gradient-to-br from-felt-dark via-felt to-felt-dark text-ivory shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-2xl text-gold-light">Phòng chờ</CardTitle>
            <ConnectionBadge status={connection} />
          </div>
          <CardDescription className="text-ivory/80">
            Gửi mã phòng cho bạn bè. Cần ít nhất 2 người chơi (có thể thêm máy); tối đa 4 người ngồi chơi, người vào
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
            {count}/4 ghế đã có người
          </span>
        </CardContent>
      </Card>

      {/* 4 Casino Seat Cards */}
      <ol className="grid gap-3.5 sm:grid-cols-2" aria-label="Chỗ ngồi">
        {seats.map((p, seat) => {
          const seatIsHost = p?.userId === room.hostId
          const seatIsMe = p?.userId === userId
          const seatLow = p && !p.isBot && p.points < MIN_POINTS && !hasBot
          return (
            <li
              key={seat}
              className={cn(
                'flex items-center justify-between gap-3 rounded-2xl border p-4 transition-all',
                p
                  ? seatIsMe
                    ? 'border-gold bg-ivory shadow-sm ring-1 ring-gold/35'
                    : 'border-card-border bg-ivory shadow-2xs'
                  : 'border-dashed border-card-border bg-cream/60 text-slate-400',
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                {/* Seat Avatar */}
                <div
                  aria-hidden
                  className={cn(
                    'relative flex size-11 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-inner ring-2',
                    !p
                      ? 'border border-dashed border-slate-300 bg-cream text-slate-400 ring-transparent'
                      : p.isBot
                        ? 'bg-wood text-gold-light ring-gold/40'
                        : seatIsHost
                          ? 'bg-gradient-to-b from-gold-light to-gold text-wood-dark ring-gold-dark/40'
                          : 'bg-felt text-ivory ring-felt-light/40',
                  )}
                >
                  {!p ? seat + 1 : p.isBot ? '⚙' : initialOf(p.displayName)}
                  {seatIsHost && (
                    <span
                      title="Chủ phòng"
                      className="absolute -right-1 -top-1.5 flex size-5 items-center justify-center rounded-full bg-ivory text-xs shadow ring-1 ring-gold"
                    >
                      👑
                    </span>
                  )}
                </div>

                {/* Seat Label & Player Info */}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-500">Ghế {seat + 1}</span>
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
                    <span className={cn('truncate font-semibold', p ? 'text-slate-900' : 'text-slate-400')}>
                      {p ? `${p.isBot ? '🤖 ' : ''}${p.displayName}` : 'Trống'}
                    </span>
                    {p && !p.isBot && (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.2 text-xs font-semibold tabular-nums',
                          seatLow
                            ? 'bg-red-100 text-suit-red ring-1 ring-suit-red/30'
                            : 'bg-amber-50 text-gold-dark ring-1 ring-gold/30',
                        )}
                      >
                        {p.points} điểm
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <span className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-500">
                <span className="rounded-md bg-cream-dark/70 px-2 py-0.5 text-slate-600 empty:hidden">
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
            </li>
          )
        })}
      </ol>

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
                className="rounded-full border border-gold/40 bg-cream px-3.5 py-1 text-sm font-medium text-slate-800"
              >
                {i + 1}. {p.displayName}
                {p.userId === userId && ' (bạn)'}
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
            {isHost && count < 4 && (
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
                : `Đang chờ thêm người (${count}/4)`}
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
    </div>
  )
}
