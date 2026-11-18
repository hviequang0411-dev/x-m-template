/** Emotes a player can send in a room. Codes must match room_messages_body_valid (migration 0015). */
export const EMOTES = [
  { code: 'happy', emoji: '😄', label: 'Vui quá' },
  { code: 'laugh', emoji: '🤣', label: 'Haha' },
  { code: 'sad', emoji: '😢', label: 'Buồn ghê' },
  { code: 'angry', emoji: '😠', label: 'Tức quá' },
  { code: 'wow', emoji: '😮', label: 'Wow' },
  { code: 'hurry', emoji: '⏰', label: 'Nhanh lên!' },
  { code: 'nice', emoji: '👏', label: 'Hay!' },
  { code: 'gg', emoji: '🤝', label: 'GG' },
] as const

export type EmoteCode = (typeof EMOTES)[number]['code']

export function emoteOf(code: string) {
  return EMOTES.find((e) => e.code === code) ?? null
}
