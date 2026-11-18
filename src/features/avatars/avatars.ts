/**
 * Built-in avatars, drawn as SVG in components/Avatar.tsx (original artwork, no image files).
 * USER_AVATAR_IDS must match the check constraint profiles_avatar_id_valid (migration 0015).
 * Bots never store an avatar: they get one of the robot avatars, picked from their id.
 */
export const USER_AVATARS = [
  { id: 'ace', label: 'Át chủ bài' },
  { id: 'queen', label: 'Nữ hoàng' },
  { id: 'dealer', label: 'Nhà cái' },
  { id: 'lucky', label: 'Thần tài' },
  { id: 'shades', label: 'Dân chơi' },
  { id: 'bun', label: 'Cô búi tóc' },
  { id: 'cap', label: 'Mũ lưỡi trai' },
  { id: 'scholar', label: 'Ông đồ' },
  { id: 'cat', label: 'Mèo may mắn' },
  { id: 'fox', label: 'Cáo' },
  { id: 'panda', label: 'Gấu trúc' },
  { id: 'tiger', label: 'Hổ' },
] as const

export type UserAvatarId = (typeof USER_AVATARS)[number]['id']

export const BOT_AVATAR_IDS = ['bot-blue', 'bot-violet', 'bot-teal', 'bot-red'] as const
export type BotAvatarId = (typeof BOT_AVATAR_IDS)[number]

export type AvatarId = UserAvatarId | BotAvatarId

const USER_IDS: ReadonlySet<string> = new Set(USER_AVATARS.map((a) => a.id))

export function isUserAvatarId(id: string | null | undefined): id is UserAvatarId {
  return typeof id === 'string' && USER_IDS.has(id)
}

/** A stable robot avatar for a bot account (same bot → same robot on every screen). */
export function botAvatarFor(userId: string): BotAvatarId {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return BOT_AVATAR_IDS[h % BOT_AVATAR_IDS.length]!
}

export function avatarLabel(id: AvatarId): string {
  return USER_AVATARS.find((a) => a.id === id)?.label ?? 'Máy'
}
