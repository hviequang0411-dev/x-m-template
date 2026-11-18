import { AvatarArt } from '@/components/Avatar'
import { USER_AVATARS, type UserAvatarId } from '@/features/avatars/avatars'
import { cn } from '@/lib/utils'

interface AvatarPickerProps {
  value: UserAvatarId | null
  /** Shown in the "no avatar" option. */
  name: string
  disabled?: boolean
  onChange: (id: UserAvatarId | null) => void
}

const optionClass = (checked: boolean) =>
  cn(
    'group grid cursor-pointer justify-items-center gap-1 rounded-xl border p-1.5 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:cursor-not-allowed disabled:opacity-60',
    checked
      ? 'border-gold bg-amber-50 shadow-sm ring-2 ring-gold/50'
      : 'border-card-border bg-ivory hover:border-gold/60 hover:bg-cream',
  )

/** Grid of the built-in avatars (a radio group). */
export function AvatarPicker({ value, name, disabled, onChange }: AvatarPickerProps) {
  const initial = name.trim() ? name.trim()[0]!.toUpperCase() : '?'
  return (
    <div role="radiogroup" aria-label="Chọn avatar" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        disabled={disabled}
        onClick={() => onChange(null)}
        className={optionClass(value === null)}
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-gradient-to-b from-gold-light to-gold font-display text-xl font-bold text-wood-dark sm:size-14"
        >
          {initial}
        </span>
        <span className="text-[11px] leading-tight font-medium text-slate-600">Chữ cái đầu</span>
      </button>
      {USER_AVATARS.map((a) => (
        <button
          key={a.id}
          type="button"
          role="radio"
          aria-checked={value === a.id}
          disabled={disabled}
          onClick={() => onChange(a.id)}
          className={optionClass(value === a.id)}
        >
          <span className="size-12 overflow-hidden rounded-full transition-transform group-hover:scale-105 sm:size-14">
            <AvatarArt id={a.id} />
          </span>
          <span className="text-[11px] leading-tight font-medium text-slate-600">{a.label}</span>
        </button>
      ))}
    </div>
  )
}
