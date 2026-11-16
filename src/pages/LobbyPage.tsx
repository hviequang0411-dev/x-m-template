import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/features/auth/store'
import { fetchMyProfile, type Profile } from '@/features/profile/api'
import { fetchMyActiveRoom, type ActiveRoom } from '@/features/rooms/api'

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
              {ROOM_STATUS_LABEL[room.status]} · Ghế {room.seat + 1}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Tạo phòng</CardTitle>
              <CardDescription>Tạo phòng riêng và mời 3 người bạn bằng mã phòng.</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Enabled on Day 5, once the create-room Edge Function exists. */}
              <Button disabled className="w-full">
                Tạo phòng (sắp ra mắt)
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Vào phòng</CardTitle>
              <CardDescription>Nhập mã phòng 6 ký tự từ chủ phòng.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button disabled variant="outline" className="w-full">
                Vào phòng (sắp ra mắt)
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
