import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-felt-deep via-felt-dark to-felt px-4 py-10">
      {/* Subtle casino suit watermark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.04] select-none"
      >
        <span className="font-display text-[16rem] text-gold-light">♠</span>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <div
            aria-hidden
            className="mx-auto mb-2.5 inline-flex items-center gap-2 rounded-full border border-gold/40 bg-felt-deep/70 px-3.5 py-1 text-xs tracking-widest text-gold-light shadow-sm"
          >
            <span>♠</span>
            <span className="text-suit-red">♥</span>
            <span>♣</span>
            <span className="text-suit-red">♦</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-gold-light drop-shadow-xs sm:text-4xl">
            Xâm Online
          </h1>
        </div>
        <Outlet />
      </div>
    </main>
  )
}
