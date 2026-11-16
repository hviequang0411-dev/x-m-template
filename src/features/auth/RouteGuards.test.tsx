import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { RequireAuth, RequireGuest } from './RouteGuards'
import { useAuthStore } from './store'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireGuest />}>
          <Route path="/login" element={<p>login page</p>} />
        </Route>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<p>lobby page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const fakeSession = { user: { id: 'u1' } } as unknown as Session

describe('route guards', () => {
  afterEach(() => useAuthStore.setState({ status: 'loading', session: null }))

  it('shows a loading state until the session is known', () => {
    renderAt('/')
    expect(screen.getByRole('status')).toHaveTextContent('Đang tải')
  })

  it('redirects signed-out users from the lobby to login', () => {
    useAuthStore.getState().setSession(null)
    renderAt('/')
    expect(screen.getByText('login page')).toBeInTheDocument()
  })

  it('lets signed-in users into the lobby', () => {
    useAuthStore.getState().setSession(fakeSession)
    renderAt('/')
    expect(screen.getByText('lobby page')).toBeInTheDocument()
  })

  it('redirects signed-in users away from login', () => {
    useAuthStore.getState().setSession(fakeSession)
    renderAt('/login')
    expect(screen.getByText('lobby page')).toBeInTheDocument()
  })
})
