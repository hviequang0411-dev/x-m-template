import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/features/auth/store'
import { fetchMyHistory, type HistoryEntry } from '@/features/match/api'
import { cn } from '@/lib/utils'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; entries: HistoryEntry[] }

const dateFormat = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

export function HistoryPage() {
  const userId = useAuthStore((s) => s.session?.user.id)
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    fetchMyHistory(userId)
      .then((entries) => {
        if (!cancelled) setLoad({ state: 'ready', entries })
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (load.state === 'loading')
    return (
      <div role="status" className="grid gap-4">
        <span className="sr-only">Đang tải…</span>
        <div className="h-8 w-40 animate-pulse rounded-lg bg-cream-dark" />
        <div className="h-20 animate-pulse rounded-2xl border border-card-border bg-ivory" />
        <div className="h-20 animate-pulse rounded-2xl border border-card-border bg-ivory" />
        <div className="h-20 animate-pulse rounded-2xl border border-card-border bg-ivory" />
      </div>
    )
  if (load.state === 'error')
    return (
      <p role="alert" className="rounded-xl border border-suit-red/30 bg-red-50 p-4 text-sm font-medium text-suit-red">
        Không tải được lịch sử. Vui lòng tải lại trang.
      </p>
    )

  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="font-display text-2xl font-bold text-slate-900 sm:text-3xl">Lịch sử ván</h2>
        <p className="text-sm text-slate-600">Kết quả các ván tính điểm đã hoàn thành gần đây.</p>
      </div>

      {load.entries.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-gold-muted/60 bg-ivory p-8 text-center shadow-2xs">
          <span
            aria-hidden
            className="inline-flex size-12 items-center justify-center rounded-full bg-cream text-2xl text-gold-dark ring-1 ring-gold/30"
          >
            ♠
          </span>
          <p className="font-medium text-slate-700">Bạn chưa chơi ván nào.</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/">Tạo hoặc vào phòng để bắt đầu</Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-2.5" aria-label="Các ván đã chơi">
          {load.entries.map((e) => (
            <li key={e.matchId}>
              <Link
                to={`/match/${e.matchId}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-card-border bg-ivory px-4 py-3.5 shadow-2xs transition-colors hover:border-gold hover:bg-cream/60"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                      e.isWinner
                        ? 'bg-gradient-to-b from-gold-light to-gold text-wood-dark ring-1 ring-gold-dark/40'
                        : 'bg-cream-dark text-slate-600',
                    )}
                  >
                    {e.isWinner ? '🏆' : '♠'}
                  </span>
                  <span className="grid min-w-0">
                    <span className="flex items-center gap-2 font-semibold text-slate-900">
                      {e.isWinner ? 'Thắng 🏆' : 'Thua'}
                      {e.cong && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-suit-red">
                          Cóng
                        </span>
                      )}
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {e.finishedAt ? dateFormat.format(new Date(e.finishedAt)) : ''}
                      {e.roomCode && ` · Phòng ${e.roomCode}`}
                      {!e.isWinner && ` · còn ${e.remainingCards} lá`}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 text-lg font-extrabold tabular-nums',
                    e.scoreDelta > 0 ? 'text-emerald-700' : 'text-suit-red',
                  )}
                >
                  {e.scoreDelta > 0 ? `+${e.scoreDelta}` : e.scoreDelta}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
