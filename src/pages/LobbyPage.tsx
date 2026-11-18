import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/FormField'
import { Avatar } from '@/components/Avatar'
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
      <div role="status" className="grid gap-6">
        <span className="sr-only">Đang tải…</span>
        <div className="h-28 animate-pulse rounded-2xl border border-card-border bg-ivory p-6" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-44 animate-pulse rounded-2xl border border-card-border bg-ivory" />
          <div className="h-44 animate-pulse rounded-2xl border border-card-border bg-ivory" />
        </div>
      </div>
    )
  if (data.state === 'error')
    return (
      <p role="alert" className="rounded-xl border border-suit-red/30 bg-red-50 p-4 text-sm font-medium text-suit-red">
        Không tải được dữ liệu. Vui lòng tải lại trang.
      </p>
    )

  const { profile, room } = data
  return (
    <div className="grid gap-6">
      {/* Luxury Casino Welcome Banner */}
      <section className="relative overflow-hidden rounded-2xl border border-gold/45 bg-gradient-to-r from-felt-dark via-felt to-felt-dark p-5 text-ivory shadow-md sm:p-6">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-4 -bottom-6 font-display text-8xl text-gold-light/10 select-none"
        >
          ♠
        </span>
        <div className="relative z-10 flex items-center gap-4">
          <Link to="/profile" title="Đổi avatar" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
            <Avatar
              avatarId={profile?.avatar_id}
              name={profile?.display_name ?? '?'}
              className="size-14 font-display text-2xl shadow-md ring-2 ring-gold-bright/60 sm:size-16"
              fallbackClassName="bg-gradient-to-b from-gold-light to-gold text-wood-dark"
            />
          </Link>
          <div className="grid min-w-0 gap-1.5">
            <p className="text-xs font-semibold tracking-wider text-gold-light/80 uppercase">Sảnh chính</p>
            <h2 className="font-display text-2xl font-bold text-gold-light sm:text-3xl">
              Xin chào, {profile?.display_name ?? 'người chơi'}
            </h2>
            {profile && (
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                <span className="casino-chip inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-extrabold tabular-nums text-wood-dark">
                  <span aria-hidden className="text-[9px]">
                    ●
                  </span>
                  {profile.total_score} điểm
                </span>
                <span className="rounded-full border border-gold/25 bg-black/25 px-2.5 py-0.5 font-medium tabular-nums text-ivory/90">
                  Đã chơi: {profile.matches_played}
                </span>
                <span className="rounded-full border border-gold/25 bg-black/25 px-2.5 py-0.5 font-medium tabular-nums text-ivory/90">
                  Thắng: {profile.matches_won}
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {room ? (
        <Card className="border-gold/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex size-8 items-center justify-center rounded-full bg-gold/20 text-sm text-gold-dark"
              >
                ♠
              </span>
              <CardTitle>Phòng hiện tại</CardTitle>
            </div>
            <CardDescription>
              Mã phòng <span className="font-mono font-bold text-slate-900">{room.code}</span> ·{' '}
              {ROOM_STATUS_LABEL[room.status]} · {room.seat === null ? 'Đang trong hàng chờ' : `Ghế ${room.seat + 1}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="gold" className="w-full font-bold sm:w-auto">
              <Link to={`/room/${room.roomId}`}>Vào phòng</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Card className="relative flex flex-col justify-between overflow-hidden border-gold/45 transition-all hover:border-gold hover:shadow-md">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-3 -bottom-4 font-display text-7xl text-gold/10 select-none"
            >
              ♠
            </span>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-flex size-9 items-center justify-center rounded-xl bg-felt text-base text-gold-light shadow-xs ring-1 ring-gold/40"
                >
                  ♠
                </span>
                <CardTitle>Tạo phòng</CardTitle>
              </div>
              <CardDescription>Tạo phòng riêng và mời 3 người bạn bằng mã phòng.</CardDescription>
            </CardHeader>
            <CardContent className="relative z-10">
              <Button variant="gold" className="w-full font-bold shadow-sm" disabled={busy !== null} onClick={() => void onCreate()}>
                {busy === 'create' ? 'Đang tạo…' : 'Tạo phòng'}
              </Button>
              {createError && (
                <p role="alert" className="mt-2 text-sm text-suit-red">
                  {createError}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="relative flex flex-col justify-between overflow-hidden border-gold/35 transition-all hover:border-gold/70 hover:shadow-md">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-3 -bottom-4 font-display text-7xl text-suit-red/8 select-none"
            >
              ♦
            </span>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="inline-flex size-9 items-center justify-center rounded-xl border border-gold/45 bg-cream text-base text-suit-red shadow-2xs"
                >
                  ♦
                </span>
                <CardTitle>Vào phòng</CardTitle>
              </div>
              <CardDescription>Nhập mã phòng 6 ký tự từ chủ phòng.</CardDescription>
            </CardHeader>
            <CardContent className="relative z-10">
              <form className="grid gap-3" onSubmit={(e) => void onJoin(e)} noValidate>
                <FormField
                  id="room-code"
                  label="Mã phòng"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  autoComplete="off"
                  autoCapitalize="characters"
                  className="font-mono text-base font-bold tracking-[0.25em]"
                  error={joinError ?? undefined}
                />
                <Button type="submit" variant="outline" className="w-full border-gold/50 font-semibold" disabled={busy !== null}>
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
