import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from './store'

function FullPageSpinner() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream px-4"
      role="status"
    >
      <span className="sr-only">Đang tải…</span>
      <div
        aria-hidden
        className="flex size-14 animate-pulse items-center justify-center rounded-full border-2 border-gold bg-felt text-2xl text-gold-light shadow-md"
      >
        ♠
      </div>
      <div aria-hidden className="grid w-full max-w-xs gap-2">
        <div className="mx-auto h-3 w-32 animate-pulse rounded-full bg-cream-dark" />
        <div className="mx-auto h-2.5 w-48 animate-pulse rounded-full bg-cream-dark/70" />
      </div>
    </div>
  )
}

export function RequireAuth() {
  const status = useAuthStore((s) => s.status)
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function RequireGuest() {
  const status = useAuthStore((s) => s.status)
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'signedIn') return <Navigate to="/" replace />
  return <Outlet />
}
