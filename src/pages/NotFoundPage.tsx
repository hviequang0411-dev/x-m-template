import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream px-4 text-center">
      <span
        aria-hidden
        className="inline-flex size-14 items-center justify-center rounded-full border-2 border-gold bg-felt text-2xl text-gold-light shadow-md"
      >
        ♠
      </span>
      <h1 className="font-display text-2xl font-bold text-slate-900">Không tìm thấy trang</h1>
      <Button asChild variant="outline">
        <Link to="/">Về sảnh</Link>
      </Button>
    </main>
  )
}
