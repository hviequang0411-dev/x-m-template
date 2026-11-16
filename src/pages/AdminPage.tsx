import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adjustPoints, listUsers, setLocked, type AdminUser } from '@/features/admin/api'
import { useAuthStore } from '@/features/auth/store'
import { useProfileStore } from '@/features/profile/store'
import { ApiCallError } from '@/lib/functions'
import { cn } from '@/lib/utils'

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; users: AdminUser[] }

const dateFormat = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' })
const message = (e: unknown) => (e instanceof ApiCallError ? e.message : 'Có lỗi xảy ra, vui lòng thử lại')

/** Admin page [R38]: accounts, point adjustments with a logged reason, lock/unlock. */
export function AdminPage() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const profile = useProfileStore((s) => s.profile)
  const [query, setQuery] = useState('')
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [notice, setNotice] = useState<string | null>(null)

  const fetchUsers = useCallback((q: string) => listUsers(q).then(
    (users): Load => ({ state: 'ready', users }),
    (e): Load => ({ state: 'error', message: message(e) }),
  ), [])
  const reload = useCallback((q: string) => fetchUsers(q).then(setLoad), [fetchUsers])

  useEffect(() => {
    if (!profile?.is_admin) return
    let cancelled = false
    void fetchUsers('').then((r) => {
      if (!cancelled) setLoad(r)
    })
    return () => {
      cancelled = true
    }
  }, [profile?.is_admin, fetchUsers])

  if (!profile) return <p role="status" className="text-slate-500">Đang tải…</p>
  if (!profile.is_admin)
    return (
      <p role="alert" className="text-red-600">
        Bạn không có quyền quản trị.
      </p>
    )

  function onSearch(e: FormEvent) {
    e.preventDefault()
    setLoad({ state: 'loading' })
    void reload(query)
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="text-2xl font-semibold">Quản trị tài khoản</h2>
        <p className="text-sm text-slate-500">
          Điểm chỉ dùng để chơi thử, không có giá trị tiền tệ và không được mua bán. Mọi lần cộng/trừ đều được ghi lại.
        </p>
      </div>

      <form onSubmit={onSearch} className="flex flex-wrap items-end gap-2" role="search">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="admin-search">Tìm theo tên, tên đăng nhập hoặc email</Label>
          <Input id="admin-search" value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} />
        </div>
        <Button type="submit">Tìm</Button>
      </form>

      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </p>
      )}

      {load.state === 'loading' && <p role="status" className="text-slate-500">Đang tải…</p>}
      {load.state === 'error' && (
        <p role="alert" className="text-red-600">
          {load.message}
        </p>
      )}
      {load.state === 'ready' &&
        (load.users.length === 0 ? (
          <p className="text-slate-500">Không tìm thấy tài khoản nào.</p>
        ) : (
          <ul className="grid gap-3" aria-label="Tài khoản">
            {load.users.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === userId}
                onDone={(text) => {
                  setNotice(text)
                  void reload(query)
                }}
              />
            ))}
          </ul>
        ))}
    </div>
  )
}

function UserRow({ user, isSelf, onDone }: { user: AdminUser; isSelf: boolean; onDone: (text: string) => void }) {
  const [mode, setMode] = useState<'idle' | 'points' | 'lock'>('idle')
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setMode('idle')
      setDelta('')
      setReason('')
      onDone(success)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }

  function onPoints(e: FormEvent) {
    e.preventDefault()
    const d = Number(delta)
    if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 100_000) return setError('Nhập số điểm nguyên khác 0 (ví dụ 20 hoặc -5)')
    if (reason.trim().length < 3) return setError('Lý do cần ít nhất 3 ký tự')
    void run(() => adjustPoints(user.id, d, reason.trim()), `${d > 0 ? 'Đã cộng' : 'Đã trừ'} ${Math.abs(d)} điểm cho ${user.display_name}`)
  }

  return (
    <li className={cn('grid gap-3 rounded-lg border bg-white p-4', user.is_locked ? 'border-red-200' : 'border-slate-200')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid min-w-0 gap-0.5">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{user.display_name}</span>
            <span className="text-sm font-normal text-slate-500">@{user.username}</span>
            {user.is_admin && <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">Quản trị</span>}
            {user.is_locked && <span className="rounded bg-red-100 px-1.5 text-xs text-red-700">Đã khoá</span>}
          </p>
          <p className="truncate text-sm text-slate-500">{user.email}</p>
          <p className="text-xs text-slate-500">
            {user.matches_played} ván · {user.matches_won} thắng · tạo {dateFormat.format(new Date(user.created_at))}
          </p>
        </div>
        <p className="text-right">
          <span className="block text-xl font-semibold tabular-nums">{user.total_score}</span>
          <span className="text-xs text-slate-500">điểm</span>
        </p>
      </div>

      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setMode('points')}>
            Cộng/trừ điểm
          </Button>
          {!isSelf && (
            <Button size="sm" variant={user.is_locked ? 'outline' : 'ghost'} onClick={() => setMode('lock')}>
              {user.is_locked ? 'Mở khoá' : 'Khoá tài khoản'}
            </Button>
          )}
        </div>
      )}

      {mode === 'points' && (
        <form onSubmit={onPoints} className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end" aria-label={`Điều chỉnh điểm ${user.display_name}`}>
          <div className="grid gap-1">
            <Label htmlFor={`delta-${user.id}`}>Số điểm (+/-)</Label>
            <Input id={`delta-${user.id}`} inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="20" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor={`reason-${user.id}`}>Lý do</Label>
            <Input id={`reason-${user.id}`} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: thưởng tham gia beta" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Đang lưu…' : 'Lưu'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode('idle')}>
              Huỷ
            </Button>
          </div>
        </form>
      )}

      {mode === 'lock' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {user.is_locked ? `Mở khoá ${user.display_name}?` : `Khoá ${user.display_name}? Họ sẽ không tạo/vào phòng hoặc bắt đầu ván được.`}
          <Button
            size="sm"
            variant={user.is_locked ? 'default' : 'destructive'}
            disabled={busy}
            onClick={() =>
              void run(() => setLocked(user.id, !user.is_locked), `${user.is_locked ? 'Đã mở khoá' : 'Đã khoá'} ${user.display_name}`)
            }
          >
            {user.is_locked ? 'Mở khoá' : 'Khoá'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
            Không
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </li>
  )
}
