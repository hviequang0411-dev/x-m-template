import { Outlet } from 'react-router-dom'

export function AuthLayout() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-felt-deep via-felt-dark to-felt px-4 py-10">
      {/* Subtle casino suit spotlight & fanned royal card silhouettes */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center select-none">
        <div className="relative flex items-center justify-center opacity-[0.07]">
          <div className="h-44 w-30 -translate-x-10 translate-y-2 -rotate-12 rounded-xl border-2 border-gold-light bg-ivory/15 p-2 text-gold-light">
            <span className="font-display text-xl font-bold">A♠</span>
          </div>
          <div className="h-44 w-30 -translate-y-2 rounded-xl border-2 border-gold-light bg-ivory/20 p-2 text-gold-light">
            <span className="font-display text-xl font-bold">K♥</span>
          </div>
          <div className="h-44 w-30 translate-x-10 translate-y-2 rotate-12 rounded-xl border-2 border-gold-light bg-ivory/15 p-2 text-gold-light">
            <span className="font-display text-xl font-bold">2♦</span>
          </div>
        </div>
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-6 text-center">
          <div
            aria-hidden
            className="mx-auto mb-2.5 inline-flex items-center gap-2 rounded-full border border-gold/45 bg-felt-deep/80 px-4 py-1 text-xs tracking-widest text-gold-light shadow-md"
          >
            <span>♠</span>
            <span className="text-suit-red">♥</span>
            <span>♣</span>
            <span className="text-suit-red">♦</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-gold-light drop-shadow-xs sm:text-4xl">
            Xâm Online
          </h1>
          <p className="mt-1 text-xs tracking-[0.22em] text-gold-light/65 uppercase">Royal Casino Club</p>
        </div>
        <Outlet />
      </div>
    </main>
  )
}
