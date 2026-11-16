import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/FormField'
import { useAuthStore } from '@/features/auth/store'
import { fetchMyProfile, updateDisplayName, type Profile } from '@/features/profile/api'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; profile: Profile }

export function ProfilePage() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [name, setName] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

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

  if (load.state === 'loading')
    return (
      <p role="status" className="text-slate-500">
        Đang tải…
      </p>
    )
  if (load.state === 'error')
    return (
      <p role="alert" className="text-red-600">
        Không tải được hồ sơ. Vui lòng tải lại trang.
      </p>
    )

  const { profile } = load
  const winRate = profile.matches_played ? Math.round((profile.matches_won / profile.matches_played) * 100) : 0
  const stats = [
    ['Tổng điểm', profile.total_score.toString()],
    ['Đã chơi', profile.matches_played.toString()],
    ['Thắng', profile.matches_won.toString()],
    ['Tỉ lệ thắng', `${winRate}%`],
  ]

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-2xl font-semibold">{profile.display_name}</h2>
        <p className="text-sm text-slate-500">@{profile.username}</p>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">Điểm chỉ để xếp hạng, không có giá trị tiền tệ.</p>

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
              <Button type="submit" disabled={saving || name.trim() === profile.display_name}>
                {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
              {message?.ok && (
                <span role="status" className="text-sm text-emerald-700">
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
