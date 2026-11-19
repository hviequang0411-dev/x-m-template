import { useMemo } from 'react'
import { Avatar } from '@/components/Avatar'
import { cn } from '@/lib/utils'

export interface ScoreboardEntry {
  userId: string
  seat: number
  displayName: string
  isBot: boolean
  avatarId?: string | null
  points?: number
  roomDelta?: number
  roomWins?: number
  cardCount?: number
}

interface RoomScoreboardProps {
  entries: readonly ScoreboardEntry[]
  currentUserId?: string
  tone?: 'dark' | 'light'
  className?: string
}

function rankBadgeStyle(rank: number, light: boolean): { text: string; badgeClass: string; rowClass: string } {
  if (rank === 1) {
    return {
      text: '1',
      badgeClass:
        'bg-gradient-to-b from-gold-shine via-gold-light to-gold-dark text-wood-dark ring-1 ring-gold-shine shadow-[0_0_10px_rgba(243,212,120,0.55)]',
      rowClass: light
        ? 'border-gold/70 bg-gradient-to-r from-amber-50/95 via-ivory to-amber-50/60 shadow-2xs'
        : 'border-gold/65 bg-gradient-to-r from-gold/22 via-gold/10 to-black/30 shadow-[0_0_12px_rgba(212,160,23,0.18)]',
    }
  }
  if (rank === 2) {
    return {
      text: '2',
      badgeClass: 'bg-gradient-to-b from-slate-100 via-slate-300 to-slate-400 text-slate-900 ring-1 ring-white/80',
      rowClass: light ? 'border-slate-300/80 bg-white/90' : 'border-white/18 bg-white/8',
    }
  }
  if (rank === 3) {
    return {
      text: '3',
      badgeClass: 'bg-gradient-to-b from-amber-200 via-amber-500 to-amber-800 text-amber-950 ring-1 ring-amber-300/60',
      rowClass: light ? 'border-amber-200/80 bg-white/85' : 'border-amber-400/20 bg-white/6',
    }
  }
  return {
    text: String(rank),
    badgeClass: light
      ? 'border border-card-border bg-cream text-slate-700'
      : 'border border-gold/25 bg-black/45 text-ivory/80',
    rowClass: light ? 'border-card-border/80 bg-ivory/80' : 'border-white/10 bg-white/4',
  }
}

function formatSignedDelta(delta: number): string {
  if (delta > 0) return `+${delta}đ`
  if (delta < 0) return `${delta}đ`
  return '0đ'
}

/**
 * Ranked room leaderboard (1–5) ordered by highest net points earned in the room,
 * then wins in room, then current balance.
 */
export function RoomScoreboard({ entries, currentUserId, tone = 'dark', className }: RoomScoreboardProps) {
  const light = tone === 'light'

  const ranked = useMemo(() => {
    return [...entries]
      .sort((a, b) => {
        const deltaDiff = (b.roomDelta ?? 0) - (a.roomDelta ?? 0)
        if (deltaDiff !== 0) return deltaDiff
        const winsDiff = (b.roomWins ?? 0) - (a.roomWins ?? 0)
        if (winsDiff !== 0) return winsDiff
        const pointsDiff = (b.points ?? 0) - (a.points ?? 0)
        if (pointsDiff !== 0) return pointsDiff
        if (typeof a.cardCount === 'number' && typeof b.cardCount === 'number') {
          const cardsDiff = a.cardCount - b.cardCount
          if (cardsDiff !== 0) return cardsDiff
        }
        return a.seat - b.seat
      })
      .slice(0, 5)
  }, [entries])

  return (
    <aside
      aria-label="Bảng điểm phòng"
      className={cn(
        'flex min-w-0 flex-col rounded-2xl border shadow-lg',
        light
          ? 'border-gold/45 bg-ivory/95 p-3 text-slate-900'
          : 'border-gold/25 bg-black/45 p-2 text-ivory backdrop-blur-md',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-b',
          light ? 'mb-2 border-gold/25 pb-1.5' : 'mb-1.5 border-gold/15 pb-1',
        )}
      >
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="text-sm leading-none">
            🏆
          </span>
          <h3
            className={cn(
              'font-display text-xs font-bold tracking-wide uppercase sm:text-[13px]',
              light ? 'text-wood-dark' : 'text-gold-light',
            )}
          >
            Bảng điểm
          </h3>
        </div>
        <span
          className={cn(
            'rounded-full border px-2 py-0.2 text-[10px] font-semibold tabular-nums',
            light
              ? 'border-gold/40 bg-amber-50 text-gold-dark'
              : 'border-gold/30 bg-gold/12 text-gold-light',
          )}
        >
          Top 1–5
        </span>
      </div>

      {ranked.length === 0 ? (
        <p className={cn('py-3 text-center text-xs', light ? 'text-slate-500' : 'text-ivory/60')}>Chưa có người chơi</p>
      ) : (
        <ol className={cn('grid', light ? 'gap-1.5' : 'gap-1')} aria-label="Xếp hạng bảng điểm">
          {ranked.map((player, idx) => {
            const rank = idx + 1
            const style = rankBadgeStyle(rank, light)
            const delta = player.roomDelta ?? 0
            const wins = player.roomWins ?? 0
            const isMe = Boolean(currentUserId && player.userId === currentUserId)

            return (
              <li
                key={player.userId}
                className={cn(
                  'flex min-w-0 items-center justify-between gap-2 rounded-xl border px-2 transition-colors',
                  light ? 'py-1.5' : 'py-1',
                  style.rowClass,
                  isMe && !light && 'ring-1 ring-gold/60',
                  isMe && light && 'ring-1 ring-gold',
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-label={`Hạng ${rank}`}
                    className={cn(
                      'inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black tabular-nums',
                      style.badgeClass,
                    )}
                  >
                    {rank === 1 ? '👑' : style.text}
                  </span>

                  <Avatar
                    avatarId={player.avatarId}
                    isBot={player.isBot}
                    userId={player.userId}
                    name={player.displayName}
                    className="size-6 shrink-0 text-[10px] ring-1 ring-gold/40"
                    fallbackClassName={light ? 'bg-felt text-ivory' : 'bg-felt-light text-gold-shine'}
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      <span
                        className={cn(
                          'truncate text-xs font-semibold',
                          light ? 'text-slate-900' : isMe ? 'text-gold-light' : 'text-ivory',
                        )}
                      >
                        {player.displayName}
                      </span>
                      {isMe && (
                        <span
                          className={cn(
                            'shrink-0 rounded px-1 text-[9px] font-bold uppercase',
                            light ? 'bg-gold/25 text-wood-dark' : 'bg-gold/25 text-gold-shine',
                          )}
                        >
                          Bạn
                        </span>
                      )}
                    </div>
                    <p className={cn('truncate text-[10px] tabular-nums', light ? 'text-slate-500' : 'text-ivory/65')}>
                      {wins > 0 ? `Nhất ${wins} ván` : player.isBot ? 'Máy luyện tập' : 'Chưa nhất'}
                      {!player.isBot && typeof player.points === 'number' ? ` · ${player.points}đ` : ''}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <span
                    className={cn(
                      'inline-block rounded-full px-2 py-0.5 text-xs font-extrabold tabular-nums',
                      delta > 0
                        ? light
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/35'
                        : delta < 0
                          ? light
                            ? 'bg-red-100 text-suit-red'
                            : 'bg-red-500/20 text-red-200 ring-1 ring-red-400/35'
                          : light
                            ? 'bg-cream text-slate-600'
                            : 'bg-white/10 text-gold-light/85',
                    )}
                    title="Tổng điểm ăn/thua trong phòng"
                  >
                    {formatSignedDelta(delta)}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}
