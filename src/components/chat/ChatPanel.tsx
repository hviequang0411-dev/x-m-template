import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Avatar } from '@/components/Avatar'
import { CHAT_MAX_LENGTH, type ChatMessage } from '@/features/chat/api'
import { emoteOf, type EmoteCode } from '@/features/chat/emotes'
import { cn } from '@/lib/utils'
import { EmoteBar } from './EmoteBar'

export interface ChatPerson {
  avatarId?: string | null
  isBot?: boolean
}

interface ChatPanelProps {
  messages: ChatMessage[]
  meId: string | undefined
  /** Avatars of the people in the room, by user id (optional). */
  people?: Readonly<Record<string, ChatPerson>>
  sending: boolean
  error: string | null
  onSendText: (text: string) => Promise<boolean>
  onSendEmote: (code: EmoteCode) => void
  tone?: 'light' | 'dark'
  className?: string
  /** Extra controls in the header (e.g. a close button). */
  headerExtra?: ReactNode
}

function timeOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

/** Room chat: the message log, emote buttons and a text box (max 200 characters). */
export function ChatPanel({
  messages,
  meId,
  people = {},
  sending,
  error,
  onSendText,
  onSendEmote,
  tone = 'light',
  className,
  headerExtra,
}: ChatPanelProps) {
  const [text, setText] = useState('')
  const logRef = useRef<HTMLOListElement>(null)
  const dark = tone === 'dark'
  const lastId = messages.at(-1)?.id

  // Follow new messages.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastId])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return
    if (await onSendText(trimmed)) setText('')
  }

  return (
    <section
      aria-label="Trò chuyện"
      className={cn(
        'flex min-h-0 flex-col gap-2 rounded-2xl border p-3',
        dark ? 'border-gold/30 bg-black/60 text-ivory backdrop-blur-md' : 'border-card-border bg-ivory shadow-2xs',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className={cn('text-sm font-semibold', dark ? 'text-gold-light' : 'text-slate-800')}>💬 Trò chuyện</h3>
        {headerExtra}
      </div>

      <ol
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Danh sách tin nhắn"
        className={cn(
          'grid min-h-24 flex-1 content-start gap-1.5 overflow-y-auto rounded-xl p-2 text-sm',
          dark ? 'bg-white/5' : 'bg-cream/70',
        )}
      >
        {messages.length === 0 && (
          <li className={cn('py-4 text-center text-xs', dark ? 'text-ivory/55' : 'text-slate-500')}>
            Chưa có tin nhắn. Gửi lời chào nhé!
          </li>
        )}
        {messages.map((m) => {
          const mine = m.userId === meId
          const person = people[m.userId]
          const emote = m.kind === 'EMOTE' ? emoteOf(m.body) : null
          return (
            <li key={m.id} className="flex items-start gap-1.5">
              <Avatar
                avatarId={person?.avatarId}
                isBot={person?.isBot}
                userId={m.userId}
                name={m.displayName}
                className="mt-0.5 size-6 text-[10px]"
              />
              <div className="min-w-0 flex-1 leading-snug">
                <span
                  className={cn(
                    'mr-1 font-semibold',
                    mine ? (dark ? 'text-gold-light' : 'text-gold-dark') : dark ? 'text-ivory' : 'text-slate-900',
                  )}
                >
                  {mine ? 'Bạn' : m.displayName}
                </span>
                <span className={cn('text-[10px] tabular-nums', dark ? 'text-ivory/45' : 'text-slate-400')}>
                  {timeOf(m.createdAt)}
                </span>
                {emote ? (
                  <p className={cn('italic', dark ? 'text-ivory/80' : 'text-slate-600')}>
                    <span aria-hidden className="not-italic">
                      {emote.emoji}{' '}
                    </span>
                    {emote.label}
                  </p>
                ) : (
                  <p className={cn('break-words whitespace-pre-wrap', dark ? 'text-ivory/90' : 'text-slate-800')}>
                    {m.body}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <EmoteBar onPick={onSendEmote} disabled={sending} tone={tone} />

      <form className="flex items-center gap-2" onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor="chat-input" className="sr-only">
          Tin nhắn
        </label>
        <input
          id="chat-input"
          value={text}
          maxLength={CHAT_MAX_LENGTH}
          autoComplete="off"
          placeholder="Nhập tin nhắn…"
          onChange={(e) => setText(e.target.value)}
          className={cn(
            'h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none',
            dark
              ? 'border-gold/30 bg-black/40 text-ivory placeholder:text-ivory/40'
              : 'border-card-border bg-white text-slate-900',
          )}
        />
        <button
          type="submit"
          disabled={sending || text.trim() === ''}
          className="inline-flex h-9 cursor-pointer items-center rounded-lg bg-gradient-to-b from-gold-light to-gold px-3.5 text-sm font-bold text-wood-dark shadow-xs transition-all hover:brightness-105 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          Gửi
        </button>
      </form>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        {error ? (
          <p role="alert" className={cn('font-medium', dark ? 'text-red-300' : 'text-suit-red')}>
            {error}
          </p>
        ) : (
          <span />
        )}
        <span className={cn('tabular-nums', dark ? 'text-ivory/45' : 'text-slate-400')} aria-hidden>
          {`${text.length}/${CHAT_MAX_LENGTH}`}
        </span>
      </div>
    </section>
  )
}
