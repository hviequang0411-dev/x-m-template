import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
      <p role="status" className="text-slate-500">
        Đang tải…
      </p>
    )
  if (load.state === 'error')
    return (
      <p role="alert" className="text-red-600">
        Không tải được lịch sử. Vui lòng tải lại trang.
      </p>
    )

  return (
    <div className="grid gap-4">
      <h2 className="text-2xl font-semibold">Lịch sử ván</h2>
      {load.entries.length === 0 ? (
        <div className="grid gap-2 rounded-lg border border-dashed border-slate-300 p-6 text-center">
          <p>Bạn chưa chơi ván nào.</p>
          <Link to="/" className="text-sm text-felt underline">
            Tạo hoặc vào phòng để bắt đầu
          </Link>
        </div>
      ) : (
        <ul className="grid gap-2" aria-label="Các ván đã chơi">
          {load.entries.map((e) => (
            <li key={e.matchId}>
              <Link
                to={`/match/${e.matchId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 hover:bg-slate-50"
              >
                <span className="grid">
                  <span className="font-medium">
                    {e.isWinner ? 'Thắng 🏆' : 'Thua'}
                    {e.cong && <span className="ml-2 rounded bg-red-50 px-1 text-xs text-red-700">Cóng</span>}
                  </span>
                  <span className="text-xs text-slate-500">
                    {e.finishedAt ? dateFormat.format(new Date(e.finishedAt)) : ''}
                    {e.roomCode && ` · Phòng ${e.roomCode}`}
                    {!e.isWinner && ` · còn ${e.remainingCards} lá`}
                  </span>
                </span>
                <span className={cn('text-lg font-semibold tabular-nums', e.scoreDelta > 0 ? 'text-emerald-700' : 'text-red-700')}>
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
