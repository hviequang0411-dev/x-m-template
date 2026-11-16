import { Link, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { signOut } from '@/features/auth/api'

export function AppLayout() {
  return (
    <div className="min-h-screen">
      <header className="bg-felt text-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link to="/" className="text-lg font-bold text-gold">
            Xâm Online
          </Link>
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
