import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/Avatar'
import { signOut } from '@/features/auth/api'
import { useAuthStore } from '@/features/auth/store'
import { useProfileStore } from '@/features/profile/store'
import { useSoundStore } from '@/lib/sound'
import { cn } from '@/lib/utils'

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-md px-2.5 py-1.5 text-sm transition-colors',
    isActive
      ? 'bg-white/12 font-semibold text-gold-light shadow-2xs'
      : 'text-ivory/80 hover:bg-white/8 hover:text-ivory',
  )

export function AppLayout() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const profile = useProfileStore((s) => s.profile)
  const refresh = useProfileStore((s) => s.refresh)
  const { pathname } = useLocation()
  const soundEnabled = useSoundStore((s) => s.enabled)
  const toggleSound = useSoundStore((s) => s.toggle)
  const [menuOpen, setMenuOpen] = useState(false)

  // Re-read the balance on every page change (it changes after matches and admin adjustments).
  useEffect(() => {
    if (userId) void refresh(userId)
  }, [userId, pathname, refresh])

  return (
    <div className="min-h-screen">
      <header className="border-b-2 border-gold-dark/70 bg-gradient-to-r from-felt-deep via-felt-dark to-felt-deep text-ivory shadow-md">
        <div className="mx-auto flex min-h-14 max-w-5xl items-center justify-between gap-1.5 px-2.5 py-2 sm:gap-2 sm:px-4">
          {/* Left: Brand Logo & Desktop Navigation */}
          <div className="flex min-w-0 items-center gap-2 sm:gap-5">
            <Link
              to="/"
              className="group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap font-display text-base font-bold tracking-tight text-gold-light transition-opacity hover:opacity-90 sm:gap-2 sm:text-xl"
            >
              <span
                aria-hidden
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold text-xs font-extrabold text-wood-dark shadow-xs ring-1 ring-gold-bright/50 sm:size-7"
              >
                ♠
              </span>
              <span>Xâm Online</span>
            </Link>

            <nav aria-label="Chính" className="hidden items-center gap-1 sm:flex">
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

          {/* Right: Account Chip, Sound Toggle, Sign Out & Mobile Hamburger */}
          <div className="flex min-w-0 items-center gap-1 text-sm sm:gap-2.5">
            {profile && (
              <span
                className="flex min-w-0 items-center gap-1 rounded-full border border-gold/30 bg-white/8 py-0.5 pl-0.5 pr-1 sm:gap-2"
                aria-label="Tài khoản"
              >
                <Link to="/profile" title="Hồ sơ" className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
                  <Avatar
                    avatarId={profile.avatar_id}
                    name={profile.display_name}
                    className="size-7 text-xs ring-1 ring-gold/50"
                    fallbackClassName="bg-gradient-to-b from-gold-light to-gold text-wood-dark"
                  />
                </Link>
                <span className="max-w-14 truncate text-xs font-medium text-ivory sm:max-w-32 sm:text-sm">
                  {profile.display_name}
                </span>
                <span
                  className="casino-chip inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold tabular-nums text-wood-dark sm:px-2.5"
                  title="Điểm hiện có (không có giá trị tiền tệ)"
                >
                  <span aria-hidden className="text-[10px]">
                    ●
                  </span>
                  {profile.total_score} điểm
                </span>
              </span>
            )}

            <button
              type="button"
              aria-pressed={soundEnabled}
              aria-label="Âm thanh"
              title={soundEnabled ? 'Âm thanh: Bật' : 'Âm thanh: Tắt'}
              onClick={toggleSound}
              className={cn(
                'inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
                soundEnabled
                  ? 'border-gold/50 bg-gold/15 text-gold-light hover:bg-gold/25'
                  : 'border-white/15 bg-white/5 text-ivory/60 hover:bg-white/10 hover:text-ivory',
              )}
            >
              <span aria-hidden className="text-sm leading-none">
                {soundEnabled ? '🔊' : '🔇'}
              </span>
              <span className="hidden md:inline">Âm thanh</span>
            </button>

            <Button
              variant="ghost"
              size="sm"
              className="hidden text-ivory/85 hover:bg-white/10 hover:text-white sm:inline-flex"
              onClick={() => void signOut()}
            >
              Đăng xuất
            </Button>

            {/* Mobile Hamburger Button */}
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border border-gold/30 bg-white/8 text-base text-gold-light hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:hidden"
            >
              <span aria-hidden>{menuOpen ? '✕' : '☰'}</span>
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {menuOpen && (
          <div className="border-t border-gold/20 bg-felt-deep/95 px-4 py-3 sm:hidden">
            <div className="flex flex-col gap-1.5">
              <NavLink to="/" end className={navClass} onClick={() => setMenuOpen(false)}>
                Sảnh chơi
              </NavLink>
              <NavLink to="/history" className={navClass} onClick={() => setMenuOpen(false)}>
                Lịch sử
              </NavLink>
              <NavLink to="/profile" className={navClass} onClick={() => setMenuOpen(false)}>
                Hồ sơ
              </NavLink>
              {profile?.is_admin && (
                <NavLink to="/admin" className={navClass} onClick={() => setMenuOpen(false)}>
                  Quản trị
                </NavLink>
              )}
              <div className="mt-1 border-t border-white/10 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-ivory/85 hover:bg-white/10 hover:text-white"
                  onClick={() => {
                    setMenuOpen(false)
                    void signOut()
                  }}
                >
                  Đăng xuất
                </Button>
              </div>
            </div>
          </div>
        )}
      </header>

      {profile?.is_locked && (
        <p
          role="alert"
          className="border-b border-suit-red/30 bg-red-50 px-4 py-2 text-center text-sm font-medium text-suit-red"
        >
          Tài khoản của bạn đang bị khoá: bạn không thể tạo, vào phòng hoặc bắt đầu ván.
        </p>
      )}

      <main
        className={cn(
          'mx-auto px-2.5 sm:px-4',
          pathname.startsWith('/match/')
            ? 'max-w-[1380px] py-2.5 sm:py-4'
            : 'max-w-5xl py-5 sm:py-8',
        )}
      >
        <Outlet />
      </main>
    </div>
  )
}
