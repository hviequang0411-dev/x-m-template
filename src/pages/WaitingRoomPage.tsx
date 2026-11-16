import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/features/auth/store'
import { startMatch } from '@/features/match/api'
import { fetchRoom, leaveRoom, type RoomView } from '@/features/rooms/api'
import { ApiCallError } from '@/lib/functions'
import { useTopic } from '@/lib/realtime'
import { cn } from '@/lib/utils'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'gone' } | { state: 'ready'; room: RoomView }

export function WaitingRoomPage() {
  const { roomId = '' } = useParams()
  const userId = useAuthStore((s) => s.session?.user.id)
  const navigate = useNavigate()
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [busy, setBusy] = useState<'start' | 'leave' | null>(null)
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

  useTopic(
    roomId ? `room:${roomId}` : null,
    (event, payload) => {
      if (event === 'match_started' && typeof payload.matchId === 'string') navigate(`/match/${payload.matchId}`)
      else void refresh()
    },
    () => void refresh(),
  )

  async function run(kind: 'start' | 'leave') {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'start') {
        const { matchId } = await startMatch(roomId)
        navigate(`/match/${matchId}`)
      } else {
        await leaveRoom(roomId)
        navigate('/')
      }
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
  const full = room.players.length === 4
  const seats = [0, 1, 2, 3].map((seat) => room.players.find((p) => p.seat === seat) ?? null)

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
          <CardTitle>Phòng chờ</CardTitle>
          <CardDescription>Gửi mã phòng cho bạn bè. Cần đủ 4 người để bắt đầu.</CardDescription>
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
              'flex items-center justify-between rounded-lg border bg-white px-4 py-3',
              p ? 'border-slate-200' : 'border-dashed border-slate-300 text-slate-400',
            )}
          >
            <span>
              <span className="mr-2 text-sm text-slate-500">Ghế {seat + 1}</span>
              <span className="font-medium">{p ? p.displayName : 'Trống'}</span>
            </span>
            <span className="text-xs text-slate-500">
              {[p?.userId === room.hostId && 'Chủ phòng', p?.userId === userId && 'Bạn'].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        {isHost ? (
          <Button disabled={!full || busy !== null} onClick={() => void run('start')}>
            {busy === 'start' ? 'Đang chia bài…' : full ? 'Bắt đầu ván' : `Chờ đủ người (${room.players.length}/4)`}
          </Button>
        ) : (
          <p className="text-sm text-slate-600" role="status">
            {full ? 'Đang chờ chủ phòng bắt đầu…' : `Đang chờ thêm người (${room.players.length}/4)`}
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
