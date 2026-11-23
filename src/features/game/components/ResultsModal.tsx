import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import type { MatchView, ResultView, SeatView } from '@/features/match/api'
import { cn } from '@/lib/utils'

const CONFETTI_PIECES = [
  { left: '8%', delay: '0s', bg: 'bg-gold-shine' },
  { left: '18%', delay: '0.12s', bg: 'bg-gold' },
  { left: '28%', delay: '0.05s', bg: 'bg-emerald-400' },
  { left: '38%', delay: '0.18s', bg: 'bg-gold-light' },
  { left: '50%', delay: '0.08s', bg: 'bg-ruby-fire' },
  { left: '62%', delay: '0.15s', bg: 'bg-gold-shine' },
  { left: '72%', delay: '0.03s', bg: 'bg-emerald-400' },
  { left: '84%', delay: '0.2s', bg: 'bg-gold' },
  { left: '93%', delay: '0.09s', bg: 'bg-gold-light' },
]

function supportsRichMotion(): boolean {
  if (typeof window === 'undefined' || typeof Element === 'undefined') return false
  if (typeof Element.prototype.animate !== 'function') return false
  return !(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false)
}

function formatDelta(v: number): string {
  return v > 0 ? `+${v}` : String(v)
}

/** Count-up / count-down number animation that renders immediately in test & reduced-motion environments. */
function AnimatedScoreDelta({ delta }: { delta: number }) {
  const [display, setDisplay] = useState(() => (supportsRichMotion() ? 0 : delta))

  useEffect(() => {
    if (!supportsRichMotion() || delta === 0) return
    const start = performance.now()
    const duration = 520
    let raf = 0

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(delta * eased))
      if (t < 1) {
        raf = window.requestAnimationFrame(tick)
      }
    }

    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [delta])

  return <>{formatDelta(display)}</>
}

interface ResultsModalProps {
  match: MatchView
  me: SeatView | undefined
  winner: SeatView | null | undefined
  foulPlayer: SeatView | null | undefined
  results: ResultView[] | null
  userId: string | undefined
  startingNext: boolean
  error: string | null
  onContinue: () => void
}

export function ResultsModal({
  match,
  me,
  winner,
  foulPlayer,
  results,
  userId,
  startingNext,
  error,
  onContinue,
}: ResultsModalProps) {
  const isWinnerMe = Boolean(winner && winner.userId === userId)
  const myResult = results?.find((r) => r.userId === userId)
  const isCongMe = myResult?.penalties.cong === true
  const isDefeatScreen = match.status === 'FINISHED' && Boolean(me) && !isWinnerMe

  return (
    <div
      className={cn(
        'inset-0 z-30 flex items-center justify-center rounded-[1.75rem] p-3 backdrop-blur-md sm:absolute sm:p-6 land:items-start land:overflow-y-auto land:p-2',
        isDefeatScreen
          ? 'bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.5)_0%,rgba(2,10,6,0.86)_100%)]'
          : 'bg-black/55',
      )}
    >
      <section
        aria-label="Kết quả"
        className="relative grid w-full max-w-xl min-w-0 gap-4 overflow-hidden rounded-2xl border-2 border-gold bg-ivory/95 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.68)] backdrop-blur-md sm:p-6"
      >
        {/* Confetti / gold chip rain on victory */}
        {match.status === 'FINISHED' && (isWinnerMe || !me) && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-32 overflow-hidden">
            {CONFETTI_PIECES.map((p, i) => (
              <span
                key={i}
                style={{ left: p.left, animationDelay: p.delay }}
                className={cn('animate-confetti absolute top-0 size-2.5 rounded-full opacity-0', p.bg)}
              />
            ))}
          </div>
        )}

        {/* Bold diagonal "CÓNG" stamp when the current user suffered Cóng */}
        {isCongMe && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-5 top-4 -rotate-12 rounded-lg border-4 border-suit-red/75 px-2.5 py-0.5 font-display text-sm font-black tracking-widest text-suit-red/85 uppercase"
          >
            CÓNG
          </span>
        )}

        <div className="grid justify-items-center gap-2 text-center">
          <span
            aria-hidden
            className={cn(
              'inline-flex size-12 items-center justify-center rounded-full text-2xl shadow-md ring-4',
              match.status === 'ABORTED'
                ? 'bg-slate-200 text-slate-600 ring-slate-300/40'
                : isWinnerMe
                  ? 'animate-crown-drop bg-gradient-to-b from-gold-shine via-gold-light to-gold ring-gold/35'
                  : 'bg-gradient-to-b from-gold-light to-gold ring-gold/25',
            )}
          >
            {match.status === 'ABORTED' ? '✕' : '👑'}
          </span>
          <p className="font-display text-xl font-bold text-slate-900 sm:text-2xl" role="status">
            {match.status === 'ABORTED'
              ? 'Ván đã bị huỷ (không tính điểm)'
              : !me
                ? `${winner?.displayName ?? 'Ván'} thắng ván này`
                : winner
                  ? winner.userId === userId
                    ? 'Bạn thắng ván này! 🏆'
                    : `${winner.displayName} thắng ván này`
                  : 'Ván đã kết thúc'}
          </p>

          {/* Special End Reason Banners */}
          {match.endReason === 'THOI_2_CUOI' && foulPlayer && (
            <p className="rounded-xl border border-suit-red/40 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-suit-red sm:text-sm">
              ⚠ {foulPlayer.displayName} đánh cây 2 cuối cùng nên bị xử thua (Thối 2)!
            </p>
          )}
          {match.endReason === 'SAM_CAUGHT' && foulPlayer && winner && (
            <p className="rounded-xl border border-suit-red/40 bg-red-50 px-3.5 py-1.5 text-xs font-semibold text-suit-red sm:text-sm">
              🛡️ {winner.displayName} đã chặn được bài Báo Xâm của {foulPlayer.displayName} và thắng ngay!
            </p>
          )}
          {match.endReason === 'SAM_SUCCESS' && winner && (
            <p className="rounded-xl border border-gold bg-amber-50 px-3.5 py-1.5 text-xs font-semibold text-amber-900 sm:text-sm">
              🔥 {winner.displayName} Báo Xâm thành công, không ai chặn được!
            </p>
          )}

          {!match.ranked && match.status === 'FINISHED' && (
            <p className="rounded-full border border-gold/40 bg-amber-50/80 px-3.5 py-1 text-xs font-medium text-amber-900 sm:text-sm">
              Ván luyện tập có máy: không cộng/trừ điểm, không ghi vào lịch sử.
            </p>
          )}
          {winner && match.status === 'FINISHED' && (
            <p className="text-xs text-slate-600">
              Ván tiếp theo: <strong>{winner.displayName}</strong> (nhất ván này) sẽ được đánh trước.
            </p>
          )}
        </div>

        {results && results.length > 0 && <ResultsTable results={results} userId={userId} />}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {me && (
            <Button variant="gold" disabled={startingNext} onClick={onContinue} className="px-6 font-bold shadow-md">
              {startingNext ? 'Đang chia bài ván mới…' : 'Tiếp tục ván mới'}
            </Button>
          )}
          <Button asChild variant={me ? 'outline' : 'gold'} className="w-fit px-5 font-semibold">
            <Link to={`/room/${match.roomId}`}>Về phòng</Link>
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-center text-sm font-medium text-suit-red">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}

/** Persisted results only: the client never computes scores. */
function ResultsTable({ results, userId }: { results: ResultView[]; userId: string | undefined }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-card-border bg-white shadow-2xs">
      <table className="w-full text-sm">
        <caption className="sr-only">Kết quả ván</caption>
        <thead>
          <tr className="border-b border-card-border bg-cream/70 text-left text-xs font-semibold tracking-wider text-slate-600 uppercase">
            <th className="px-3 py-2.5">Người chơi</th>
            <th className="px-3 py-2.5">Bài còn lại</th>
            <th className="px-3 py-2.5 text-right">Điểm</th>
          </tr>
        </thead>
        <tbody>
          {[...results]
            .sort((a, b) => b.scoreDelta - a.scoreDelta)
            .map((r, idx) => (
              <tr
                key={r.seat}
                style={{ animationDelay: `${idx * 85}ms` }}
                className={cn(
                  'animate-row-stagger border-b border-card-border/60 last:border-0',
                  r.userId === userId && 'bg-amber-50/75',
                  r.isWinner && 'font-medium',
                )}
              >
                <td className="px-3 py-2.5 align-top">
                  <span className="font-semibold text-slate-900">{r.displayName}</span>
                  {r.isWinner && ' 🏆'}
                  {r.penalties.cong && (
                    <span className="ml-1.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-suit-red ring-1 ring-suit-red/30">
                      Cóng
                    </span>
                  )}
                  {r.penalties.thoi2Cuoi && (
                    <span className="ml-1.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-suit-red ring-1 ring-suit-red/30">
                      Thối 2 cuối
                    </span>
                  )}
                  {r.penalties.denSam && (
                    <span className="ml-1.5 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-suit-red ring-1 ring-suit-red/30">
                      Đền Xâm
                    </span>
                  )}
                  {!r.penalties.thoi2Cuoi && r.penalties.thoi2 && r.penalties.thoi2 > 0 && (
                    <span className="ml-1.5 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Thối {r.penalties.thoi2} cây 2
                    </span>
                  )}
                  {r.penalties.owed !== undefined && (
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">
                      Nợ {r.penalties.owed}, trả hết {-r.scoreDelta} điểm đang có
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 align-top">
                  {r.remainingCards === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1" aria-label={`${r.remainingCards} lá: ${r.remainingHand.join(' ')}`}>
                      {r.remainingHand.map((c) => (
                        <span
                          key={c}
                          className="rounded border border-card-border bg-cream px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800"
                        >
                          {c}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td
                  className={cn(
                    'px-3 py-2.5 text-right text-base font-extrabold tabular-nums align-top',
                    r.scoreDelta > 0 ? 'text-emerald-700' : r.scoreDelta < 0 ? 'text-suit-red' : 'text-slate-600',
                  )}
                >
                  <AnimatedScoreDelta delta={r.scoreDelta} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
