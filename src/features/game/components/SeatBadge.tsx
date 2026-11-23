import { Avatar } from '@/components/Avatar'
import { CardBackStack } from '@/components/cards/PlayingCard'
import { EmoteBubble } from '@/components/chat/EmoteBubble'
import type { EmoteBubbleState } from '@/features/chat/useRoomChat'
import type { MatchView, SeatView } from '@/features/match/api'
import { cn } from '@/lib/utils'

const TURN_SECONDS_MAX = 30

interface SeatBadgeProps {
  seat: SeatView
  match: MatchView
  online: boolean
  secondsLeft: number | null
  bubble?: EmoteBubbleState
  className?: string
  seatRef?: (el: HTMLLIElement | null) => void
}

/** Displays one opponent seated around the casino oval table with timer ring, card stack, points & badges. */
export function SeatBadge({ seat, match, online, secondsLeft, bubble, className, seatRef }: SeatBadgeProps) {
  const playing = match.status === 'PLAYING'
  const isTurn = playing && match.currentSeat === seat.seat
  const passed = match.passedSeats.includes(seat.seat)
  const isWinner = match.winnerSeat === seat.seat
  const isSam = match.samSeat === seat.seat
  const isUrgent = isTurn && secondsLeft !== null && secondsLeft <= 5
  const progress = isTurn && secondsLeft !== null ? Math.min(1, Math.max(0, secondsLeft / TURN_SECONDS_MAX)) : 0
  const circumference = 2 * Math.PI * 19

  return (
    <li
      ref={seatRef}
      aria-current={isTurn ? 'true' : undefined}
      className={cn(
        'casino-glass-panel relative flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border p-2 text-center text-xs text-ivory shadow-md transition-all sm:flex-row sm:items-center sm:gap-2.5 sm:p-2.5 sm:text-left sm:text-sm land:gap-2 land:rounded-xl land:px-2 land:py-1 land:text-xs',
        isTurn
          ? 'animate-turn-seat border-gold-light bg-black/70'
          : isSam && playing
            ? 'animate-fire-border border-ruby-fire bg-gradient-to-b from-suit-red-dark/70 to-black/75'
            : 'border-gold/30 hover:border-gold/50',
        passed && playing && 'opacity-60',
        className,
      )}
    >
      {/* Winner dropped crown */}
      {isWinner && (
        <span
          aria-hidden
          className="animate-crown-drop absolute -top-3 left-1/2 z-20 flex size-6 -translate-x-1/2 items-center justify-center rounded-full bg-gradient-to-b from-gold-shine to-gold text-sm shadow-md ring-2 ring-gold-dark sm:left-5 sm:translate-x-0"
        >
          👑
        </span>
      )}

      {/* Pass bubble */}
      {passed && playing && !bubble && (
        <span className="animate-pass-pop pointer-events-none absolute -bottom-2.5 right-2 z-20 rounded-full border border-white/25 bg-black/85 px-2 py-0.5 text-[10px] font-semibold italic text-ivory/90 shadow">
          Đã bỏ
        </span>
      )}

      {/* Avatar with gold frame and 30s SVG countdown ring */}
      <div
        className={cn('relative flex size-10 shrink-0 items-center justify-center sm:size-12 land:size-9', isUrgent && 'animate-urgent-ring')}
        aria-hidden
      >
        {isTurn && secondsLeft !== null && (
          <svg className="absolute inset-0 size-full -rotate-90" viewBox="0 0 44 44">
            <circle cx="22" cy="22" r="19" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="2.75" />
            <circle
              cx="22"
              cy="22"
              r="19"
              fill="none"
              stroke={isUrgent ? '#ef4444' : '#f3d478'}
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
            />
          </svg>
        )}
        <Avatar
          avatarId={seat.avatarId}
          isBot={seat.isBot}
          userId={seat.userId}
          name={seat.displayName}
          className={cn(
            'size-8 text-xs font-extrabold shadow-inner ring-2 sm:size-9 land:size-7',
            isUrgent ? 'ring-red-400' : isTurn ? 'ring-gold-shine' : 'ring-gold/45',
          )}
          fallbackClassName={isTurn ? 'bg-gold text-wood-dark' : 'bg-felt text-ivory'}
        />
      </div>

      {bubble && (
        <EmoteBubble key={bubble.key} code={bubble.code} name={seat.displayName} className="-top-7 right-1 sm:-top-8 sm:right-2" />
      )}

      {/* Seat text info: IMPORTANT — keep `li p:first-child` strictly equal to optional `🤖 ` + `displayName` */}
      <div className="grid w-full min-w-0 flex-1 justify-items-center gap-0.5 sm:justify-items-start">
        <p className="flex max-w-full items-center justify-center gap-1 truncate font-semibold text-ivory sm:justify-start">
          <span
            aria-label={online ? 'Đang online' : 'Mất kết nối'}
            title={online ? 'Đang online' : 'Mất kết nối'}
            className={cn('size-2 shrink-0 rounded-full', online ? 'bg-emerald-400' : 'bg-slate-400')}
          />
          <span className="truncate">
            {seat.isBot && <span aria-label="Máy">🤖 </span>}
            {seat.displayName}
          </span>
        </p>

        {/* Points chip (humans) or Practice label (bots) */}
        <div className="flex flex-wrap items-center justify-center gap-1 sm:justify-start land:hidden">
          {seat.isBot ? (
            <span className="rounded-full border border-white/15 bg-white/10 px-1.5 py-0.2 text-[10px] font-medium text-ivory/75">
              Máy
            </span>
          ) : typeof seat.points === 'number' ? (
            <span className="casino-chip inline-flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-extrabold tabular-nums text-wood-dark sm:text-[11px]">
              <span aria-hidden className="text-[8px]">
                ●
              </span>
              {seat.points} điểm
            </span>
          ) : null}
        </div>

        {/* Remaining cards stack + Báo 1 / Báo Xâm */}
        <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start land:mt-0">
          <span className="hidden sm:inline-flex land:hidden">
            <CardBackStack count={seat.cardCount} />
          </span>
          <p className="text-[11px] font-bold tabular-nums text-gold-light sm:text-xs">
            {seat.cardCount} lá
            {seat.cardCount === 1 && playing && (
              <span className="animate-bao1-pulse ml-1 inline-flex items-center rounded-full bg-suit-red px-1.5 py-0.2 text-[10px] font-extrabold text-white">
                🔥 Báo 1
              </span>
            )}
            {isSam && playing && (
              <span className="ml-1 inline-flex items-center rounded-full border border-gold/60 bg-suit-red-dark px-1.5 py-0.2 text-[10px] font-extrabold text-gold-light">
                🔥 Báo Xâm
              </span>
            )}
          </p>
        </div>

        <p className="hidden max-w-full truncate text-[11px] text-ivory/70 sm:block land:hidden">
          {[isTurn && 'Đang đánh', passed && 'Đã bỏ', !seat.hasPlayed && 'Chưa đánh'].filter(Boolean).join(' · ') || '\u00A0'}
        </p>
      </div>
    </li>
  )
}
