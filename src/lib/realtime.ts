import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Subscribes to a private Realtime topic (`room:<id>` / `match:<id>`) while mounted.
 * - `onEvent` gets every broadcast.
 * - `onResync` runs whenever the channel (re)subscribes and when the tab becomes visible again,
 *   so a dropped connection is followed by a fresh fetch of the authoritative state (ARCHITECTURE §5).
 */
export function useTopic(
  topic: string | null,
  onEvent: (event: string, payload: Record<string, unknown>) => void,
  onResync: () => void,
) {
  const eventRef = useRef(onEvent)
  const resyncRef = useRef(onResync)
  useEffect(() => {
    eventRef.current = onEvent
    resyncRef.current = onResync
  })

  useEffect(() => {
    if (!topic) return
    let channel: RealtimeChannel | null = null
    let cancelled = false

    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      await supabase.realtime.setAuth(data.session?.access_token ?? null)
      channel = supabase
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: '*' }, (msg) => eventRef.current(msg.event, (msg.payload ?? {}) as Record<string, unknown>))
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') resyncRef.current()
        })
    })()

    const onVisible = () => {
      if (document.visibilityState === 'visible') resyncRef.current()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [topic])
}
