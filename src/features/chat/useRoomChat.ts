import { useCallback, useEffect, useRef, useState } from 'react'
import { ChatError, fetchRoomMessages, sendRoomMessage, toChatMessage, type ChatMessage } from './api'
import type { EmoteCode } from './emotes'

/** How long an emote bubble stays next to the sender's seat. */
export const EMOTE_BUBBLE_MS = 3500
const MAX_MESSAGES = 100

export interface EmoteBubbleState {
  code: string
  /** Message id: a new emote from the same player restarts the bubble. */
  key: number
}

export interface RoomChat {
  messages: ChatMessage[]
  /** Active emote bubbles, by sender user id. */
  bubbles: Readonly<Record<string, EmoteBubbleState>>
  error: string | null
  sending: boolean
  /** Highest message id in the first history load of this room (0 until loaded): what was said before. */
  historyUpToId: number
  /** Feed every `chat` broadcast of the room topic here. */
  receive: (payload: Record<string, unknown>) => void
  /** Re-read the history (call when the room topic (re)subscribes). */
  reload: () => void
  sendText: (text: string) => Promise<boolean>
  sendEmote: (code: EmoteCode) => Promise<boolean>
}

/**
 * Chat + emotes of one room. Messages arrive on the room's existing private topic (event `chat`),
 * which the page already subscribes to, so the page forwards them with `receive`. The server is
 * authoritative for membership, length and rate limits; errors come back as Vietnamese text.
 */
export function useRoomChat(roomId: string | null): RoomChat {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [bubbles, setBubbles] = useState<Record<string, EmoteBubbleState>>({})
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [historyUpToId, setHistoryUpToId] = useState<number | null>(null)
  const seen = useRef(new Set<number>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const roomRef = useRef(roomId)

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]))
      for (const m of incoming) byId.set(m.id, m)
      return [...byId.values()].sort((a, b) => a.id - b.id).slice(-MAX_MESSAGES)
    })
  }, [])

  const showBubble = useCallback((m: ChatMessage) => {
    setBubbles((b) => ({ ...b, [m.userId]: { code: m.body, key: m.id } }))
    const old = timers.current.get(m.userId)
    if (old) clearTimeout(old)
    timers.current.set(
      m.userId,
      setTimeout(() => {
        timers.current.delete(m.userId)
        setBubbles((b) => {
          if (b[m.userId]?.key !== m.id) return b
          const next = { ...b }
          delete next[m.userId]
          return next
        })
      }, EMOTE_BUBBLE_MS),
    )
  }, [])

  const accept = useCallback(
    (m: ChatMessage) => {
      if (m.roomId !== roomRef.current || seen.current.has(m.id)) return
      seen.current.add(m.id)
      merge([m])
      if (m.kind === 'EMOTE') showBubble(m)
    },
    [merge, showBubble],
  )

  const receive = useCallback(
    (payload: Record<string, unknown>) => {
      const m = toChatMessage(payload)
      if (m) accept(m)
    },
    [accept],
  )

  const reload = useCallback(() => {
    const room = roomRef.current
    if (!room) return
    fetchRoomMessages(room)
      .then((list) => {
        if (roomRef.current !== room) return
        for (const m of list) seen.current.add(m.id)
        merge(list)
        setHistoryUpToId((prev) => prev ?? list.reduce((max, m) => Math.max(max, m.id), 0))
      })
      .catch(() => {
        // History is a nicety; live messages still arrive.
      })
  }, [merge])

  // Another room: start from an empty log (state reset during render, then load its history).
  const [shownRoom, setShownRoom] = useState(roomId)
  if (shownRoom !== roomId) {
    setShownRoom(roomId)
    setMessages([])
    setBubbles({})
    setError(null)
    setHistoryUpToId(null)
  }
  useEffect(() => {
    roomRef.current = roomId
    seen.current = new Set()
    reload()
  }, [roomId, reload])

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) clearTimeout(t)
      map.clear()
    }
  }, [])

  const send = useCallback(
    async (kind: 'TEXT' | 'EMOTE', body: string) => {
      const room = roomRef.current
      if (!room) return false
      setSending(true)
      setError(null)
      try {
        accept(await sendRoomMessage(room, kind, body))
        return true
      } catch (e) {
        setError(e instanceof ChatError ? e.message : 'Không gửi được, vui lòng thử lại.')
        return false
      } finally {
        setSending(false)
      }
    },
    [accept],
  )

  const sendText = useCallback((text: string) => send('TEXT', text), [send])
  const sendEmote = useCallback((code: EmoteCode) => send('EMOTE', code), [send])

  return { messages, bubbles, error, sending, historyUpToId: historyUpToId ?? 0, receive, reload, sendText, sendEmote }
}
