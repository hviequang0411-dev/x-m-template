import { useState } from 'react'
import { Link } from 'react-router-dom'
import { canLockLandscape, enterLandscapeFullscreen } from '@/lib/fullscreen'
import { cn } from '@/lib/utils'

interface RotateDeviceHintProps {
  /** Shown as a pill so a player who is mid-turn knows to hurry. */
  notice?: string | null
  /** Where "back" goes (the waiting room). */
  backTo: string
  className?: string
}

/**
 * Full-screen cover shown only on touch phones held upright (`phone-portrait` variant). The table
 * underneath keeps running (timers, realtime), so turning the phone resumes play instantly.
 */
export function RotateDeviceHint({ notice, backTo, className }: RotateDeviceHintProps) {
  const [lockable] = useState(canLockLandscape)
  const [failed, setFailed] = useState(false)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rotate-hint-title"
      className={cn(
        'fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-5 overflow-y-auto bg-felt-deep px-6 py-8 text-center text-ivory phone-portrait:flex',
        className,
      )}
      style={{
        backgroundImage:
          'radial-gradient(ellipse at 50% 38%, rgba(28,107,75,0.85) 0%, rgba(15,81,50,0.6) 38%, rgba(4,27,16,1) 85%)',
      }}
    >
      {/* Phone outline turning sideways */}
      <div aria-hidden className="relative flex size-36 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-gold/25 bg-black/20" />
        <span className="animate-rotate-device relative flex h-24 w-14 flex-col items-center justify-between rounded-[0.9rem] border-[3px] border-gold-light bg-felt-dark/80 py-1.5 shadow-[0_0_24px_rgba(243,212,120,0.35)]">
          <span className="h-1 w-5 rounded-full bg-gold-light/70" />
          <span className="flex gap-0.5">
            <span className="h-5 w-3.5 rounded-[3px] bg-ivory shadow-sm" />
            <span className="h-5 w-3.5 rounded-[3px] bg-ivory shadow-sm" />
            <span className="h-5 w-3.5 rounded-[3px] bg-ivory shadow-sm" />
          </span>
          <span className="size-2 rounded-full border border-gold-light/70" />
        </span>
        <span className="absolute -right-1 top-3 text-2xl text-gold-light/80">↻</span>
      </div>

      <div className="grid max-w-xs gap-2">
        <h2 id="rotate-hint-title" className="font-display text-2xl font-bold text-gold-light">
          Xoay ngang điện thoại
        </h2>
        <p className="text-sm leading-relaxed text-ivory/80">
          Bàn chơi cần màn hình ngang để hiển thị đầy đủ các ghế, bài trên bàn và bài của bạn.
        </p>
      </div>

      {notice && (
        <p
          role="status"
          className="animate-bao1-pulse rounded-full border border-gold-bright bg-gradient-to-r from-gold-shine via-gold-light to-gold px-4 py-1.5 text-sm font-extrabold text-wood-dark"
        >
          {notice}
        </p>
      )}

      <div className="grid w-full max-w-xs gap-2.5">
        {lockable && (
          <button
            type="button"
            onClick={() => void enterLandscapeFullscreen().then((ok) => setFailed(!ok))}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gold-bright bg-gradient-to-b from-gold-light to-gold px-5 text-base font-extrabold text-wood-dark shadow-[0_6px_18px_rgba(212,160,23,0.4)] focus-visible:ring-2 focus-visible:ring-gold-shine focus-visible:outline-none active:scale-[0.98]"
          >
            <span aria-hidden>⤢</span>
            Xoay ngang &amp; toàn màn hình
          </button>
        )}
        {(!lockable || failed) && (
          <p className="text-xs text-ivory/60">
            Nếu màn hình không tự xoay, hãy tắt <strong className="text-ivory/85">Khoá xoay màn hình</strong> trong cài
            đặt nhanh của điện thoại.
          </p>
        )}
        <Link
          to={backTo}
          className="text-sm font-medium text-ivory/70 underline-offset-4 hover:text-gold-light hover:underline"
        >
          Về phòng chờ
        </Link>
      </div>
    </div>
  )
}
