import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { RequireAuth, RequireGuest } from '@/features/auth/RouteGuards'
import { AuthLayout } from '@/pages/AuthLayout'
import { AppLayout } from '@/pages/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { LobbyPage } from '@/pages/LobbyPage'
import { WaitingRoomPage } from '@/pages/WaitingRoomPage'
import { GameTablePage } from '@/pages/GameTablePage'
import { ProfilePage } from '@/pages/ProfilePage'
import { HistoryPage } from '@/pages/HistoryPage'
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
          { path: '/room/:roomId', element: <WaitingRoomPage /> },
          { path: '/match/:matchId', element: <GameTablePage /> },
          { path: '/profile', element: <ProfilePage /> },
          { path: '/history', element: <HistoryPage /> },
        ],
      },
    ],
  },
  ...devRoutes,
  { path: '*', element: <NotFoundPage /> },
])
