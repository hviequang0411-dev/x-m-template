import { useState } from 'react'
import { cryptoRandomInt, shuffleAndDeal, XAM_BASELINE_V1, type CardCode } from '@engine'
import { Button } from '@/components/ui/button'
import { Hand } from '@/components/cards/Hand'
import { useSelectionStore } from '@/features/game/selectionStore'

function dealSeat0(): CardCode[] {
  return shuffleAndDeal(XAM_BASELINE_V1, cryptoRandomInt).hands[0]!.map((c) => c.code)
}

/** Dev-only page (not in production builds) for eyeballing the card and hand UI. */
export function CardsPreviewPage() {
  const [hand, setHand] = useState<CardCode[]>(dealSeat0)
  const [disabled, setDisabled] = useState(false)
  const selected = useSelectionStore((s) => s.selected)
  const clear = useSelectionStore((s) => s.clear)

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Xem trước lá bài (dev)</h1>
      <div className="rounded-xl bg-felt px-2 pb-6 pt-4">
        <Hand cards={hand} disabled={disabled} />
      </div>
      <p className="text-sm text-slate-600" aria-live="polite">
        Đã chọn: {selected.length ? selected.join(', ') : 'không có'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setHand(dealSeat0())}>Chia lại</Button>
        <Button variant="outline" onClick={clear}>
          Bỏ chọn
        </Button>
        <Button variant="outline" onClick={() => setHand((h) => h.filter((c) => !selected.includes(c)))}>
          Bỏ lá đã chọn khỏi tay
        </Button>
        <Button variant="outline" onClick={() => setDisabled((d) => !d)}>
          {disabled ? 'Bật chọn bài' : 'Khoá chọn bài'}
        </Button>
      </div>
    </main>
  )
}
