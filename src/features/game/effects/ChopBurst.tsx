/**
 * Decorative burst overlay displayed when a Four-of-a-Kind chops a Deuce (Chặt 2 bằng Tứ quý).
 */
export function ChopBurst({ show }: { show: boolean }) {
  if (!show) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden"
    >
      <div className="animate-chop-burst relative flex flex-col items-center">
        {/* Radial burst rays */}
        <span className="absolute -inset-8 rounded-full bg-gradient-to-r from-ruby-fire/40 via-gold/45 to-ruby-fire/40 blur-xl" />
        <div className="relative flex items-center gap-2 rounded-2xl border-2 border-gold-bright bg-gradient-to-b from-suit-red to-suit-red-dark px-6 py-2.5 shadow-[0_0_36px_rgba(255,77,42,0.85)]">
          <span className="text-2xl">⚡</span>
          <span className="font-display text-2xl font-black tracking-wider text-gold-shine drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] sm:text-3xl">
            CHẶT!
          </span>
          <span className="text-2xl">⚡</span>
        </div>
        <span className="mt-1.5 rounded-full border border-gold/70 bg-black/75 px-3 py-0.5 text-xs font-bold text-gold-light shadow">
          Tứ quý chặn 2!
        </span>
      </div>
    </div>
  )
}
