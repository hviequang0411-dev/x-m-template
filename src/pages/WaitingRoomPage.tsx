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
        const { matchId } = await startMatch(roomId)
        navigate(`/match/${matchId}`)
        return
      }
      if (kind === 'leave') {
        await leaveRoom(roomId)
        navigate('/')
        return
      }
      if (kind === 'addBot') await addBot(roomId)
      else await removeBot(roomId, kind.removeBot)
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
      <p role="status" className="text-slate-500">
        Đang tải phòng…
      </p>
    )
  if (load.state === 'error')
    return (
      <p role="alert" className="text-red-600">
        Không tải được phòng. Vui lòng tải lại trang.
      </p>
    )
  if (load.state === 'gone')
    return (
      <div className="grid gap-3">
        <p>Phòng không tồn tại hoặc bạn không còn ở trong phòng này.</p>
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
  const seats = [0, 1, 2, 3].map((seat) => room.players.find((p) => p.seat === seat) ?? null)
  const isOnline = (p: RoomPlayer) => p.isBot || online.has(p.userId)

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: the code is on screen anyway
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Phòng chờ</CardTitle>
            <ConnectionBadge status={connection} />
          </div>
          <CardDescription>
            Gửi mã phòng cho bạn bè. Cần ít nhất 2 người chơi (có thể thêm máy); tối đa 4 người ngồi chơi, người vào
            sau sẽ chờ ván tiếp theo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-3xl font-bold tracking-[0.3em]" aria-label={`Mã phòng ${room.code.split('').join(' ')}`}>
            {room.code}
          </span>
          <Button variant="outline" size="sm" onClick={() => void copyCode()}>
            {copied ? 'Đã chép' : 'Chép mã'}
          </Button>
        </CardContent>
      </Card>

      <ol className="grid gap-3 sm:grid-cols-2" aria-label="Chỗ ngồi">
        {seats.map((p, seat) => (
          <li
            key={seat}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg border bg-white px-4 py-3',
              p ? 'border-slate-200' : 'border-dashed border-slate-300 text-slate-400',
            )}
          >
            <span className="min-w-0">
              <span className="mr-2 text-sm text-slate-500">Ghế {seat + 1}</span>
              {p && (
                <span
                  aria-label={isOnline(p) ? 'Đang online' : 'Mất kết nối'}
                  title={isOnline(p) ? 'Đang online' : 'Mất kết nối'}
                  className={cn('mr-1.5 inline-block size-2 rounded-full', isOnline(p) ? 'bg-emerald-500' : 'bg-slate-300')}
                />
              )}
              <span className="font-medium">{p ? `${p.isBot ? '🤖 ' : ''}${p.displayName}` : 'Trống'}</span>
              {p && !p.isBot && (
                <span className={cn('ml-2 text-xs tabular-nums', p.points < MIN_POINTS ? 'text-red-600' : 'text-slate-500')}>
                  {p.points} điểm
                </span>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
              {[p?.userId === room.hostId && 'Chủ phòng', p?.userId === userId && 'Bạn', p?.isBot && 'Máy']
                .filter(Boolean)
                .join(' · ')}
              {p?.isBot && isHost && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-slate-500"
                  disabled={busy !== null}
                  aria-label={`Bỏ ${p.displayName}`}
                  onClick={() => void run({ removeBot: p.userId })}
                >
                  Bỏ
                </Button>
              )}
            </span>
          </li>
        ))}
      </ol>

      {room.waiting.length > 0 && (
        <section aria-label="Hàng chờ" className="grid gap-2">
          <h3 className="text-sm font-medium text-slate-700">Hàng chờ ({room.waiting.length})</h3>
          <ol className="flex flex-wrap gap-2">
            {room.waiting.map((p, i) => (
              <li key={p.userId} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm">
                {i + 1}. {p.displayName}
                {p.userId === userId && ' (bạn)'}
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">Người chờ sẽ được xếp vào ghế trống khi ván hiện tại kết thúc.</p>
        </section>
      )}

      {canStart && (
        <p className="text-sm text-slate-600">
          {hasBot ? (
            <>
              Ván có máy là <strong>ván luyện tập</strong>: không cộng/trừ điểm và không ghi vào lịch sử.
            </>
          ) : lowPoints.length > 0 ? (
            <span className="text-red-600" role="alert">
              Mỗi người cần ít nhất {MIN_POINTS} điểm để chơi ván tính điểm. Chưa đủ:{' '}
              {lowPoints.map((p) => p.displayName).join(', ')}.
            </span>
          ) : (
            <>Ván tính điểm: người thua trả 1 điểm/lá (cóng 15), tối đa bằng số điểm đang có.</>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {isHost ? (
          <>
            <Button disabled={!canStart || busy !== null || lowPoints.length > 0} onClick={() => void run('start')}>
              {busy === 'start' ? 'Đang chia bài…' : canStart ? `Bắt đầu ván (${count} người)` : 'Cần ít nhất 2 người'}
            </Button>
            {count < 4 && (
              <Button variant="outline" disabled={busy !== null} onClick={() => void run('addBot')}>
                {busy === 'bot' ? 'Đang thêm…' : 'Thêm máy'}
              </Button>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-600" role="status">
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
          <Link to={`/match/${room.currentMatchId}`} className="text-sm text-slate-600 underline">
            Xem ván vừa chơi
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
