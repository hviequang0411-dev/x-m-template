import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { RequireAuth, RequireGuest } from '@/features/auth/RouteGuards'
import { AuthLayout } from '@/pages/AuthLayout'
import { AppLayout } from '@/pages/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { LobbyPage } from '@/pages/LobbyPage'
import { NotFoundPage } from '@/pages/NotFoundPage'

// Dev-only previews. `import.meta.env.DEV` is false in production builds, so this code is dropped.
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/cards',
        lazy: async () => ({ Component: (await import('@/dev/CardsPreviewPage')).CardsPreviewPage }),
      },
      {
        path: '/dev/table',
        lazy: async () => ({ Component: (await import('@/dev/HotSeatPage')).HotSeatPage }),
      },
    ]
  : []

export const router = createBrowserRouter([
  {
    element: <RequireGuest />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <LobbyPage /> },
          // Loaded on demand so the first page (login/lobby) stays small.
          { path: '/room/:roomId', lazy: async () => ({ Component: (await import('@/pages/WaitingRoomPage')).WaitingRoomPage }) },
          { path: '/match/:matchId', lazy: async () => ({ Component: (await import('@/pages/GameTablePage')).GameTablePage }) },
          { path: '/profile', lazy: async () => ({ Component: (await import('@/pages/ProfilePage')).ProfilePage }) },
          { path: '/history', lazy: async () => ({ Component: (await import('@/pages/HistoryPage')).HistoryPage }) },
        ],
      },
    ],
  },
  ...devRoutes,
  { path: '*', element: <NotFoundPage /> },
])
