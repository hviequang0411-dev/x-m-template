import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/FormField'
import { Avatar } from '@/components/Avatar'
import { AvatarPicker } from '@/components/AvatarPicker'
import { useAuthStore } from '@/features/auth/store'
import { isUserAvatarId, type UserAvatarId } from '@/features/avatars/avatars'
import { fetchMyProfile, updateAvatar, updateDisplayName, type Profile } from '@/features/profile/api'
import { useProfileStore } from '@/features/profile/store'
import { cn } from '@/lib/utils'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; profile: Profile }

export function ProfilePage() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [name, setName] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [avatarState, setAvatarState] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null })
  const refreshHeader = useProfileStore((s) => s.refresh)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchMyProfile(userId)
      .then((profile) => {
        if (cancelled) return
        if (!profile) return setLoad({ state: 'error' })
        setLoad({ state: 'ready', profile })
        setName(profile.display_name)
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!userId || load.state !== 'ready') return
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 32) {
      setMessage({ ok: false, text: 'Tên hiển thị từ 1 đến 32 ký tự' })
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      await updateDisplayName(userId, trimmed)
      setLoad({ state: 'ready', profile: { ...load.profile, display_name: trimmed } })
      setName(trimmed)
      setMessage({ ok: true, text: 'Đã lưu' })
    } catch {
      setMessage({ ok: false, text: 'Không lưu được, vui lòng thử lại' })
    } finally {
      setSaving(false)
    }
  }

  async function onPickAvatar(id: UserAvatarId | null) {
    if (!userId || load.state !== 'ready') return
    const before = load.profile
    setLoad({ state: 'ready', profile: { ...before, avatar_id: id } })
    setAvatarState({ saving: true, error: null })
    try {
      await updateAvatar(userId, id)
      setAvatarState({ saving: false, error: null })
      void refreshHeader(userId)
    } catch {
      setLoad({ state: 'ready', profile: before })
      setAvatarState({ saving: false, error: 'Không lưu được avatar, vui lòng thử lại' })
    }
  }

  if (load.state === 'loading')
    return (
      <div role="status" className="grid gap-6">
        <span className="sr-only">Đang tải…</span>
        <div className="h-24 animate-pulse rounded-2xl border border-card-border bg-ivory" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
          <div className="h-20 animate-pulse rounded-xl border border-card-border bg-ivory" />
        </div>
        <div className="h-44 animate-pulse rounded-2xl border border-card-border bg-ivory" />
      </div>
    )
  if (load.state === 'error')
    return (
      <p role="alert" className="rounded-xl border border-suit-red/30 bg-red-50 p-4 text-sm font-medium text-suit-red">
        Không tải được hồ sơ. Vui lòng tải lại trang.
      </p>
    )

  const { profile } = load
  const winRate = profile.matches_played ? Math.round((profile.matches_won / profile.matches_played) * 100) : 0
  const stats = [
    ['Tổng điểm', profile.total_score.toString(), true],
    ['Đã chơi', profile.matches_played.toString(), false],
    ['Thắng', profile.matches_won.toString(), false],
    ['Tỉ lệ thắng', `${winRate}%`, false],
  ] as const

  return (
    <div className="grid gap-6">
      <section className="flex items-center gap-4 rounded-2xl border border-gold/45 bg-gradient-to-r from-felt-dark via-felt to-felt-dark p-5 text-ivory shadow-md sm:p-6">
        <Avatar
          avatarId={profile.avatar_id}
          name={profile.display_name}
          className="size-16 font-display text-2xl shadow-md ring-2 ring-gold-bright/60"
          fallbackClassName="bg-gradient-to-b from-gold-light to-gold text-wood-dark"
        />
        <div className="min-w-0">
          <h2 className="truncate font-display text-2xl font-bold text-gold-light sm:text-3xl">
            {profile.display_name}
          </h2>
          <p className="text-sm text-ivory/75">@{profile.username}</p>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {stats.map(([label, value, highlight]) => (
          <div
            key={label}
            className={cn(
              'rounded-2xl border p-4 shadow-2xs',
              highlight
                ? 'border-gold/60 bg-gradient-to-br from-amber-50/90 to-ivory'
                : 'border-card-border bg-ivory',
            )}
          >
            <dt className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{label}</dt>
            <dd
              className={cn(
                'mt-1 text-2xl font-extrabold tabular-nums',
                highlight ? 'text-wood-dark' : 'text-slate-900',
              )}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">Điểm chỉ để xếp hạng, không có giá trị tiền tệ.</p>

      <Card>
        <CardHeader>
          <CardTitle>Avatar</CardTitle>
          <CardDescription>Chọn hình đại diện hiện ở ghế ngồi, phòng chờ và khung chat.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <AvatarPicker
            value={isUserAvatarId(profile.avatar_id) ? profile.avatar_id : null}
            name={profile.display_name}
            disabled={avatarState.saving}
            onChange={(id) => void onPickAvatar(id)}
          />
          {avatarState.error && (
            <p role="alert" className="text-sm font-medium text-suit-red">
              {avatarState.error}
            </p>
          )}
          {avatarState.saving && (
            <p role="status" className="text-sm text-slate-500">
              Đang lưu…
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Đổi tên hiển thị</CardTitle>
          <CardDescription>Tên này hiện với người chơi khác trong phòng.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:max-w-sm" onSubmit={(e) => void onSave(e)} noValidate>
            <FormField
              id="display-name"
              label="Tên hiển thị"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              error={message && !message.ok ? message.text : undefined}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" variant="gold" disabled={saving || name.trim() === profile.display_name} className="font-bold">
                {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
              {message?.ok && (
                <span role="status" className="text-sm font-medium text-emerald-700">
                  {message.text}
                </span>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
