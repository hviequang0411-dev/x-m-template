import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

interface TopicOptions {
  /** Track presence under this key (only allowed on `room:` topics) and report who is online. */
  presenceKey?: string
}

interface TopicState {
  status: ConnectionStatus
  /** Presence keys currently online (empty unless `presenceKey` is set). */
  online: ReadonlySet<string>
}

/**
 * Subscribes to a private Realtime topic (`room:<id>` / `match:<id>`) while mounted.
 * - `onEvent` gets every broadcast.
 * - `onResync` runs whenever the channel (re)subscribes, the tab becomes visible again or the
 *   browser comes back online, so a dropped connection is always followed by a fresh fetch of the
 *   authoritative state (ARCHITECTURE §5, R28).
 * Presence is display-only (who is online). It never affects game logic.
 */
export function useTopic(
  topic: string | null,
  onEvent: (event: string, payload: Record<string, unknown>) => void,
  onResync: () => void,
  options: TopicOptions = {},
): TopicState {
  const eventRef = useRef(onEvent)
  const resyncRef = useRef(onResync)
  useEffect(() => {
    eventRef.current = onEvent
    resyncRef.current = onResync
  })
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set())
  const { presenceKey } = options

  useEffect(() => {
    if (!topic) return
    let channel: RealtimeChannel | null = null
    let cancelled = false
    let everConnected = false

    void (async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      await supabase.realtime.setAuth(data.session?.access_token ?? null)
      channel = supabase.channel(topic, {
        config: { private: true, ...(presenceKey ? { presence: { key: presenceKey } } : {}) },
      })
      channel.on('broadcast', { event: '*' }, (msg) =>
        eventRef.current(msg.event, (msg.payload ?? {}) as Record<string, unknown>),
      )
      if (presenceKey) {
        channel.on('presence', { event: 'sync' }, () => {
          setOnline(new Set(Object.keys(channel?.presenceState() ?? {})))
        })
      }
      channel.subscribe((s) => {
        if (s === 'SUBSCRIBED') {
          everConnected = true
          setStatus('connected')
          if (presenceKey) void channel?.track({ at: Date.now() })
          resyncRef.current()
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          setStatus(navigator.onLine ? (everConnected ? 'reconnecting' : 'connecting') : 'offline')
        }
      })
    })()

    const onVisible = () => {
      if (document.visibilityState === 'visible') resyncRef.current()
    }
    const onOnline = () => {
      setStatus((s) => (s === 'offline' ? 'reconnecting' : s))
      resyncRef.current()
    }
    const onOffline = () => setStatus('offline')
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [topic, presenceKey])

  return { status, online }
}
