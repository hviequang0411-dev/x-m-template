import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-felt px-4 py-10">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-3xl font-bold tracking-tight text-gold">Xâm Online</h1>
        <Outlet />
      </div>
    </main>
  )
}
