import { Link, NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { signOut } from '@/features/auth/api'

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="bg-felt text-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-lg font-bold text-gold">
              Xâm Online
            </Link>
            <nav aria-label="Chính" className="flex gap-3 text-sm">
              {[
                ['/history', 'Lịch sử'],
                ['/profile', 'Hồ sơ'],
              ].map(([to, label]) => (
                <NavLink
                  key={to}
                  to={to!}
                  className={({ isActive }) => (isActive ? 'font-semibold text-white' : 'text-white/75 hover:text-white')}
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-felt-dark"
            onClick={() => void signOut()}
          >
            Đăng xuất
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
