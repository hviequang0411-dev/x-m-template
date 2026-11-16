import { useEffect } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { signOut } from '@/features/auth/api'
import { useAuthStore } from '@/features/auth/store'
import { useProfileStore } from '@/features/profile/store'

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'font-semibold text-white' : 'text-white/75 hover:text-white'

export function AppLayout() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const profile = useProfileStore((s) => s.profile)
  const refresh = useProfileStore((s) => s.refresh)
  const { pathname } = useLocation()

  // Re-read the balance on every page change (it changes after matches and admin adjustments).
  useEffect(() => {
    if (userId) void refresh(userId)
  }, [userId, pathname, refresh])

  return (
    <div className="min-h-screen">
      <header className="bg-felt text-white">
        <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-lg font-bold text-gold">
              Xâm Online
            </Link>
            <nav aria-label="Chính" className="flex gap-3 text-sm">
              <NavLink to="/history" className={navClass}>
                Lịch sử
              </NavLink>
              <NavLink to="/profile" className={navClass}>
                Hồ sơ
              </NavLink>
              {profile?.is_admin && (
                <NavLink to="/admin" className={navClass}>
                  Quản trị
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {profile && (
              <span className="flex items-center gap-2" aria-label="Tài khoản">
                <span className="max-w-32 truncate font-medium">{profile.display_name}</span>
                <span
                  className="rounded-full bg-white/15 px-2 py-0.5 font-semibold tabular-nums text-gold"
                  title="Điểm hiện có (không có giá trị tiền tệ)"
                >
                  {profile.total_score} điểm
                </span>
              </span>
            )}
            <Button variant="ghost" size="sm" className="text-white hover:bg-felt-dark" onClick={() => void signOut()}>
              Đăng xuất
            </Button>
          </div>
        </div>
      </header>
      {profile?.is_locked && (
        <p role="alert" className="bg-red-50 px-4 py-2 text-center text-sm text-red-700">
          Tài khoản của bạn đang bị khoá: bạn không thể tạo, vào phòng hoặc bắt đầu ván.
        </p>
      )}
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
