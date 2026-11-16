import type { ConnectionStatus } from '@/lib/realtime'
import { cn } from '@/lib/utils'

const LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  reconnecting: 'Đang kết nối lại…',
  offline: 'Mất mạng',
}

/** Shows the Realtime connection state. Display only: the server stays authoritative. */
export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'connected' && 'bg-emerald-50 text-emerald-700',
        (status === 'connecting' || status === 'reconnecting') && 'bg-amber-50 text-amber-700',
        status === 'offline' && 'bg-red-50 text-red-700',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          status === 'connected' && 'bg-emerald-500',
          (status === 'connecting' || status === 'reconnecting') && 'animate-pulse bg-amber-500',
          status === 'offline' && 'bg-red-500',
        )}
      />
      {LABEL[status]}
    </span>
  )
}
