import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/FormField'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/features/auth/store'
import { fetchMyProfile, type Profile } from '@/features/profile/api'
import { createRoom, fetchMyActiveRoom, joinRoom, type ActiveRoom } from '@/features/rooms/api'
import { ApiCallError } from '@/lib/functions'

const ROOM_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/

function errorMessage(e: unknown): string {
  return e instanceof ApiCallError ? e.message : 'Có lỗi xảy ra, vui lòng thử lại'
}

type LobbyData =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'ready'; profile: Profile | null; room: ActiveRoom | null }

const ROOM_STATUS_LABEL: Record<ActiveRoom['status'], string> = {
  WAITING: 'Đang chờ',
  PLAYING: 'Đang chơi',
  CLOSED: 'Đã đóng',
}

export function LobbyPage() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [data, setData] = useState<LobbyData>({ state: 'loading' })
  const navigate = useNavigate()
  const [busy, setBusy] = useState<'create' | 'join' | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  async function onCreate() {
    setBusy('create')
    setCreateError(null)
    try {
      const { roomId } = await createRoom()
      navigate(`/room/${roomId}`)
    } catch (e) {
      setCreateError(errorMessage(e))
      setBusy(null)
    }
  }

  async function onJoin(e: FormEvent) {
    e.preventDefault()
    const normalized = code.trim().toUpperCase()
    if (!ROOM_CODE_RE.test(normalized)) {
      setJoinError('Mã phòng gồm 6 ký tự (chữ in hoa và số, không có 0, O, 1, I)')
      return
    }
    setBusy('join')
    setJoinError(null)
    try {
      const { roomId } = await joinRoom(normalized)
      navigate(`/room/${roomId}`)
    } catch (err) {
      setJoinError(errorMessage(err))
      setBusy(null)
    }
  }

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    Promise.all([fetchMyProfile(userId), fetchMyActiveRoom(userId)])
      .then(([profile, room]) => {
        if (!cancelled) setData({ state: 'ready', profile, room })
      })
      .catch(() => {
        if (!cancelled) setData({ state: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (data.state === 'loading')
    return (
      <p className="text-slate-500" role="status">
        Đang tải…
      </p>
    )
  if (data.state === 'error')
    return (
      <p role="alert" className="text-red-600">
        Không tải được dữ liệu. Vui lòng tải lại trang.
      </p>
    )

  const { profile, room } = data
  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-2xl font-semibold">Xin chào, {profile?.display_name ?? 'người chơi'}</h2>
        {profile && (
          <p className="text-sm text-slate-500">
            Điểm: {profile.total_score} · Đã chơi: {profile.matches_played} · Thắng: {profile.matches_won}
          </p>
        )}
      </section>

      {room ? (
        <Card>
          <CardHeader>
            <CardTitle>Phòng hiện tại</CardTitle>
            <CardDescription>
              Mã phòng <span className="font-mono font-semibold">{room.code}</span> ·{' '}
              {ROOM_STATUS_LABEL[room.status]} · {room.seat === null ? 'Đang trong hàng chờ' : `Ghế ${room.seat + 1}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full sm:w-auto">
              <Link to={`/room/${room.roomId}`}>Vào phòng</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tạo phòng</CardTitle>
              <CardDescription>Tạo phòng riêng và mời 3 người bạn bằng mã phòng.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button className="w-full" disabled={busy !== null} onClick={() => void onCreate()}>
                {busy === 'create' ? 'Đang tạo…' : 'Tạo phòng'}
              </Button>
              {createError && (
                <p role="alert" className="mt-2 text-sm text-red-600">
                  {createError}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Vào phòng</CardTitle>
              <CardDescription>Nhập mã phòng 6 ký tự từ chủ phòng.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={(e) => void onJoin(e)} noValidate>
                <FormField
                  id="room-code"
                  label="Mã phòng"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="font-mono tracking-widest"
                  error={joinError ?? undefined}
                />
                <Button type="submit" variant="outline" className="w-full" disabled={busy !== null}>
                  {busy === 'join' ? 'Đang vào…' : 'Vào phòng'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
