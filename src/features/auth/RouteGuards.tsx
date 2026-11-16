import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from './store'

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-slate-500" role="status">
      Đang tải…
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
