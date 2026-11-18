import { useId, type ReactNode } from 'react'
import { botAvatarFor, isUserAvatarId, type AvatarId, type BotAvatarId, type UserAvatarId } from '@/features/avatars/avatars'
import { cn } from '@/lib/utils'

/*
 * Built-in avatar artwork: simple original SVG drawings on a 64×64 canvas, clipped to a circle.
 * Each avatar = background + body + head + hair/ears + face details.
 */

const INK = '#2b1d14'

function Body({ fill }: { fill: string }) {
  return <path d="M9 66c0-13 10-19 23-19s23 6 23 19z" fill={fill} />
}

function Head({ skin, neck = true }: { skin: string; neck?: boolean }) {
  return (
    <>
      {neck && <rect x="27.5" y="38" width="9" height="10" rx="3.5" fill={skin} opacity="0.85" />}
      <circle cx="32" cy="29" r="13" fill={skin} />
    </>
  )
}

function Face({ smile = true, cheeks = true, eyeY = 30 }: { smile?: boolean; cheeks?: boolean; eyeY?: number }) {
  return (
    <>
      <circle cx="27" cy={eyeY} r="1.7" fill={INK} />
      <circle cx="37" cy={eyeY} r="1.7" fill={INK} />
      {cheeks && (
        <>
          <circle cx="24.5" cy="34" r="2" fill="#f08a7a" opacity="0.45" />
          <circle cx="39.5" cy="34" r="2" fill="#f08a7a" opacity="0.45" />
        </>
      )}
      {smile && <path d="M27.5 35.2q4.5 3.6 9 0" stroke="#7a3b2a" strokeWidth="1.8" fill="none" strokeLinecap="round" />}
    </>
  )
}

const SHORT_HAIR = 'M19 29c0-9 6-14.5 13-14.5S45 20 45 29c-2.5-4.5-6.5-7-13-7s-10.5 2.5-13 7z'

function Muzzle({ fill = '#fff8ef', nose = '#3a2420' }: { fill?: string; nose?: string }) {
  return (
    <>
      <ellipse cx="32" cy="35.5" rx="7" ry="5" fill={fill} />
      <path d="M30 33h4l-2 2.2z" fill={nose} />
      <path d="M32 35.2v1.5M32 36.7q-1.6 1.4-3 .3M32 36.7q1.6 1.4 3 .3" stroke={nose} strokeWidth="1" fill="none" strokeLinecap="round" />
    </>
  )
}

function Whiskers() {
  return (
    <g stroke="#5a4636" strokeWidth="0.8" strokeLinecap="round" opacity="0.7">
      <path d="M24 35l-7-1M24 37l-7 1.5M40 35l7-1M40 37l7 1.5" />
    </g>
  )
}

const USER_ART: Record<UserAvatarId, { bg: string; art: ReactNode }> = {
  ace: {
    bg: '#d4a017',
    art: (
      <>
        <Body fill="#1d2b44" />
        <path d="M32 50l-3.5 4.5 3.5 6 3.5-6z" fill="#f7f3eb" />
        <Head skin="#f1c6a0" />
        <path d={SHORT_HAIR} fill="#3a2516" />
        <Face />
      </>
    ),
  },
  queen: {
    bg: '#7b2d5f',
    art: (
      <>
        <path d="M17 30c0-10 7-16 15-16s15 6 15 16v15c-3 2.5-6.5 2.5-9 0V30H26v15c-2.5 2.5-6 2.5-9 0z" fill="#5b2a14" />
        <Body fill="#c42026" />
        <Head skin="#f5cfae" />
        <path d={SHORT_HAIR} fill="#5b2a14" />
        <path d="M22 18l3-8.5 4 5 3-7.5 3 7.5 4-5 3 8.5z" fill="#f3c33b" stroke="#a87b0a" strokeWidth="0.8" />
        <circle cx="32" cy="15" r="1.4" fill="#c42026" />
        <Face />
        <path d="M27.5 35.6q4.5 2.6 9 0" stroke="#c42026" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  dealer: {
    bg: '#0f5132',
    art: (
      <>
        <Body fill="#f7f3eb" />
        <path d="M22 47l10 6 10-6v19H22z" fill="#231209" opacity="0.9" />
        <path d="M25.5 49.5l6.5 3-6.5 3.2zM38.5 49.5l-6.5 3 6.5 3.2z" fill="#c42026" />
        <circle cx="32" cy="52.6" r="1.6" fill="#99161b" />
        <Head skin="#e5b48f" />
        <path d={SHORT_HAIR} fill="#1b130d" />
        <path d="M17.5 24.5q14.5-9 29 0l-1.2 3.3q-13.3-6.8-26.6 0z" fill="#1fa463" opacity="0.92" />
        <path d="M18.5 25q13.5-7.5 27 0" stroke="#f3d478" strokeWidth="1" fill="none" />
        <Face />
      </>
    ),
  },
  lucky: {
    bg: '#99161b',
    art: (
      <>
        <Body fill="#c42026" />
        <path d="M24 47h16l-2 4H26z" fill="#f3c33b" />
        <Head skin="#f3c9a3" />
        <path d="M18.5 24q13.5-15 27 0v2.5h-27z" fill="#c42026" />
        <rect x="18.5" y="23" width="27" height="3.5" rx="1.5" fill="#f3c33b" />
        <circle cx="32" cy="17" r="2" fill="#f3c33b" />
        <Face smile={false} />
        <path d="M25.5 35.5q3.2-2.4 6.5-.3q3.3-2.1 6.5.3q-3.4 1.4-6.5.4q-3.1 1-6.5-.4z" fill="#2b1d14" />
        <path d="M30 38.5q2 1.4 4 0" stroke="#7a3b2a" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  shades: {
    bg: '#1d2b44',
    art: (
      <>
        <Body fill="#d4a017" />
        <path d="M29 47h6l-3 6z" fill="#1d2b44" />
        <Head skin="#d9a27a" />
        <path d="M19 28l1.5-8 3.5 3 1.5-7.5 3.5 4.5 3-6.5 3 6.5 3.5-4.5 1.5 7.5 3.5-3 1.5 8c-3-4-7.5-6-13-6s-10 2-13 6z" fill="#14100c" />
        <Face />
        <rect x="21.5" y="27" width="9" height="6" rx="2.2" fill="#0e0e12" />
        <rect x="33.5" y="27" width="9" height="6" rx="2.2" fill="#0e0e12" />
        <path d="M30.5 29.2h3" stroke="#0e0e12" strokeWidth="1.4" />
        <path d="M23 28.5l3 0" stroke="#ffffff" strokeWidth="0.9" opacity="0.6" strokeLinecap="round" />
      </>
    ),
  },
  bun: {
    bg: '#2f6f8f',
    art: (
      <>
        <Body fill="#f3d478" />
        <Head skin="#f6d2b4" />
        <circle cx="32" cy="13.5" r="6" fill="#2b1a10" />
        <path d={SHORT_HAIR} fill="#2b1a10" />
        <path d="M27 13.5h10" stroke="#c42026" strokeWidth="1.6" strokeLinecap="round" />
        <Face />
      </>
    ),
  },
  cap: {
    bg: '#f7f3eb',
    art: (
      <>
        <Body fill="#0f5132" />
        <Head skin="#eab894" />
        <path d="M19 26.5q0-12 13-12t13 12z" fill="#1f5fbf" />
        <path d="M31 24.5h18q-.8 3.3-5 3.3H31z" fill="#174a96" />
        <circle cx="32" cy="14.8" r="1.4" fill="#174a96" />
        <Face />
      </>
    ),
  },
  scholar: {
    bg: '#5e3821',
    art: (
      <>
        <Body fill="#26324a" />
        <path d="M32 47v19" stroke="#f3d478" strokeWidth="1.2" />
        <Head skin="#efc39e" />
        <path d="M22 33q10 18 20 0q-1.5 11-10 13.5q-8.5-2.5-10-13.5z" fill="#f2f0ea" />
        <path d="M18.5 25.5c0-9 6-12.5 13.5-12.5s13.5 3.5 13.5 12.5c-4-2-9-3-13.5-3s-9.5 1-13.5 3z" fill="#26324a" />
        <path d="M19.5 21.5q12.5-6 25 0M20.5 18q11.5-5.5 23 0" stroke="#3d4c6b" strokeWidth="1" fill="none" />
        <path d="M24.5 27.3h4.5M35 27.3h4.5" stroke="#f2f0ea" strokeWidth="1.6" strokeLinecap="round" />
        <Face smile={false} cheeks={false} />
        <path d="M27 35.5q2.5-1.6 5 0q2.5-1.6 5 0" stroke="#e4e1d8" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  cat: {
    bg: '#176942',
    art: (
      <>
        <Body fill="#f2a541" />
        <path d="M19.5 24l1.5-12.5 9 6.5zM44.5 24L43 11.5l-9 6.5z" fill="#f2a541" />
        <path d="M22 20.5l.8-6 4.2 3.2zM42 20.5l-.8-6-4.2 3.2z" fill="#f6b8b0" />
        <Head skin="#f2a541" neck={false} />
        <path d="M28 17.5l1 4M32 16.5v4.5M36 17.5l-1 4" stroke="#c97a1e" strokeWidth="1.6" strokeLinecap="round" />
        <Muzzle nose="#d0605a" />
        <Whiskers />
        <circle cx="26.5" cy="28.5" r="1.9" fill={INK} />
        <circle cx="37.5" cy="28.5" r="1.9" fill={INK} />
      </>
    ),
  },
  fox: {
    bg: '#1d2b44',
    art: (
      <>
        <Body fill="#e8742a" />
        <path d="M32 47l-6 19h12z" fill="#fff8ef" />
        <path d="M18 25l1-15 11 8zM46 25l-1-15-11 8z" fill="#e8742a" />
        <path d="M20.5 21l.6-7.5 5.4 4zM43.5 21l-.6-7.5-5.4 4z" fill="#2b1d14" />
        <Head skin="#e8742a" neck={false} />
        <path d="M19.2 31q5.5 11 12.8 11t12.8-11q-5 3.5-12.8 3.5t-12.8-3.5z" fill="#fff8ef" />
        <ellipse cx="32" cy="35.5" rx="2.2" ry="1.6" fill="#2b1d14" />
        <path d="M24.5 28.8q2.5-1.8 5 0M34.5 28.8q2.5-1.8 5 0" stroke={INK} strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </>
    ),
  },
  panda: {
    bg: '#8c6608',
    art: (
      <>
        <Body fill="#1a1a1a" />
        <circle cx="21" cy="18" r="5.5" fill="#1a1a1a" />
        <circle cx="43" cy="18" r="5.5" fill="#1a1a1a" />
        <Head skin="#fbfaf6" neck={false} />
        <ellipse cx="26.2" cy="29.5" rx="3.6" ry="4.6" transform="rotate(25 26.2 29.5)" fill="#1a1a1a" />
        <ellipse cx="37.8" cy="29.5" rx="3.6" ry="4.6" transform="rotate(-25 37.8 29.5)" fill="#1a1a1a" />
        <circle cx="26.8" cy="29" r="1.2" fill="#ffffff" />
        <circle cx="37.2" cy="29" r="1.2" fill="#ffffff" />
        <ellipse cx="32" cy="35" rx="2.3" ry="1.6" fill="#1a1a1a" />
        <path d="M32 36.4q-1.6 1.6-3.2.5M32 36.4q1.6 1.6 3.2.5" stroke="#1a1a1a" strokeWidth="1" fill="none" strokeLinecap="round" />
        <circle cx="23.5" cy="35.5" r="1.8" fill="#f6b8b0" opacity="0.6" />
        <circle cx="40.5" cy="35.5" r="1.8" fill="#f6b8b0" opacity="0.6" />
      </>
    ),
  },
  tiger: {
    bg: '#0f5132',
    art: (
      <>
        <Body fill="#f39c33" />
        <path d="M24 52l4 3M40 52l-4 3M22 58l5 2M42 58l-5 2" stroke="#2b1d14" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="21" cy="18.5" r="5" fill="#f39c33" />
        <circle cx="43" cy="18.5" r="5" fill="#f39c33" />
        <circle cx="21" cy="18.5" r="2.4" fill="#2b1d14" />
        <circle cx="43" cy="18.5" r="2.4" fill="#2b1d14" />
        <Head skin="#f39c33" neck={false} />
        <path d="M32 16.5v4M28.5 17.5l1.5 3.5M35.5 17.5L34 21M19.5 27h4M19.8 31h3.6M44.5 27h-4M44.2 31h-3.6" stroke="#2b1d14" strokeWidth="1.8" strokeLinecap="round" />
        <Muzzle />
        <Whiskers />
        <circle cx="26.5" cy="28.5" r="1.9" fill={INK} />
        <circle cx="37.5" cy="28.5" r="1.9" fill={INK} />
      </>
    ),
  },
}

const BOT_COLOR: Record<BotAvatarId, { bg: string; main: string; glow: string }> = {
  'bot-blue': { bg: '#13233f', main: '#4f8fe8', glow: '#9fe7ff' },
  'bot-violet': { bg: '#221538', main: '#9b74e8', glow: '#ffd36e' },
  'bot-teal': { bg: '#0b2a26', main: '#2fb5a3', glow: '#c6ff8e' },
  'bot-red': { bg: '#2c1111', main: '#e05a4f', glow: '#ffe08a' },
}

function BotArt({ id }: { id: BotAvatarId }) {
  const c = BOT_COLOR[id]
  return (
    <>
      <path d="M12 66c0-11 8-17 20-17s20 6 20 17z" fill={c.main} />
      <rect x="24" y="52" width="16" height="7" rx="2" fill="#0d1117" opacity="0.55" />
      <circle cx="28" cy="55.5" r="1.3" fill={c.glow} />
      <circle cx="32" cy="55.5" r="1.3" fill={c.glow} opacity="0.6" />
      <circle cx="36" cy="55.5" r="1.3" fill={c.glow} opacity="0.3" />
      <rect x="28.5" y="42" width="7" height="8" fill="#9aa3ad" />
      <path d="M32 18V10" stroke="#c9d1d9" strokeWidth="1.8" />
      <circle cx="32" cy="9" r="2.6" fill={c.glow} />
      <rect x="14.5" y="25" width="4" height="9" rx="1.5" fill="#9aa3ad" />
      <rect x="45.5" y="25" width="4" height="9" rx="1.5" fill="#9aa3ad" />
      <rect x="17.5" y="17" width="29" height="26" rx="7" fill="#d5dbe1" />
      <rect x="17.5" y="17" width="29" height="6" rx="3" fill={c.main} opacity="0.85" />
      <rect x="21" y="25" width="22" height="10" rx="5" fill="#0d1117" />
      <circle cx="27" cy="30" r="2.4" fill={c.glow} />
      <circle cx="37" cy="30" r="2.4" fill={c.glow} />
      <path d="M26 38.5h12" stroke="#7d8590" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 2" />
    </>
  )
}

/** The SVG for one avatar id (user or bot), filling its container. */
export function AvatarArt({ id, className }: { id: AvatarId; className?: string }) {
  // useId() may contain characters (':' '«') that break url(#…) references.
  const clip = `av${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const isBot = id.startsWith('bot-')
  const bg = isBot ? BOT_COLOR[id as BotAvatarId].bg : USER_ART[id as UserAvatarId].bg
  return (
    <svg viewBox="0 0 64 64" className={cn('block size-full', className)} aria-hidden focusable="false" data-avatar={id}>
      <defs>
        <clipPath id={clip}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="64" fill={bg} />
        <circle cx="32" cy="32" r="27" fill="#ffffff" opacity="0.08" />
        {isBot ? <BotArt id={id as BotAvatarId} /> : USER_ART[id as UserAvatarId].art}
      </g>
    </svg>
  )
}

function initialOf(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0]!.toUpperCase() : '?'
}

export interface AvatarProps {
  /** profiles.avatar_id (ignored for bots). */
  avatarId?: string | null
  /** Needed for bots: picks their robot. */
  userId?: string
  isBot?: boolean
  /** Display name: used for the initial when no avatar was picked. */
  name: string
  /** Size, ring, etc. Defaults to size-10. */
  className?: string
  /** Colors for the initial-letter fallback. */
  fallbackClassName?: string
}

/** A player's avatar: their picked artwork, a robot for bots, else their initial. Decorative. */
export function Avatar({ avatarId, userId, isBot, name, className, fallbackClassName }: AvatarProps) {
  const id: AvatarId | null = isBot ? botAvatarFor(userId ?? name) : isUserAvatarId(avatarId) ? avatarId : null
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full font-bold select-none',
        !id && (fallbackClassName ?? 'bg-felt text-ivory'),
        className,
      )}
    >
      {id ? <AvatarArt id={id} /> : initialOf(name)}
    </span>
  )
}
