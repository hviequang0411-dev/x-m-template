import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BOT_AVATAR_IDS, USER_AVATARS, botAvatarFor, isUserAvatarId } from '@/features/avatars/avatars'
import { EMOTES } from '@/features/chat/emotes'
import { Avatar } from './Avatar'
import { AvatarPicker } from './AvatarPicker'
import migration from '../../supabase/migrations/20261118000015_avatars_chat_emotes.sql?raw'

const quoted = (sql: string) => [...sql.matchAll(/'([a-z]+)'/g)].map((m) => m[1])

describe('avatar and emote lists match the database (migration 0015)', () => {
  it('user avatar ids', () => {
    const check = migration.slice(migration.indexOf('profiles_avatar_id_valid'), migration.indexOf('grant update (avatar_id)'))
    expect(quoted(check).sort()).toEqual(USER_AVATARS.map((a) => a.id).sort())
  })

  it('emote codes', () => {
    const check = migration.slice(migration.indexOf("kind = 'EMOTE' and body in"), migration.indexOf('create index room_messages_room_idx'))
    expect(quoted(check).filter((c) => c !== 'EMOTE').sort()).toEqual(EMOTES.map((e) => e.code).sort())
  })
})

describe('Avatar', () => {
  it('draws the picked avatar', () => {
    const { container } = render(<Avatar avatarId="fox" name="An" />)
    expect(container.querySelector('svg[data-avatar="fox"]')).toBeInTheDocument()
    expect(container).not.toHaveTextContent('A')
  })

  it('falls back to the initial when nothing (or an unknown id) is stored', () => {
    const { container, rerender } = render(<Avatar avatarId={null} name="bình" />)
    expect(container).toHaveTextContent('B')
    expect(container.querySelector('svg')).toBeNull()
    rerender(<Avatar avatarId="hacker" name="bình" />)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('bots always get a robot, the same one for the same bot', () => {
    const { container } = render(<Avatar isBot userId="bot-123" avatarId="fox" name="Máy" />)
    const id = container.querySelector('svg')?.getAttribute('data-avatar')
    expect(BOT_AVATAR_IDS).toContain(id)
    expect(id).toBe(botAvatarFor('bot-123'))
    expect(botAvatarFor('bot-123')).toBe(botAvatarFor('bot-123'))
  })

  it('every avatar has its own clip path id', () => {
    const { container } = render(
      <>
        <Avatar avatarId="cat" name="A" />
        <Avatar avatarId="cat" name="B" />
      </>,
    )
    const ids = [...container.querySelectorAll('clipPath')].map((c) => c.id)
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
  })

  it('isUserAvatarId rejects bot ids', () => {
    expect(isUserAvatarId('panda')).toBe(true)
    expect(isUserAvatarId('bot-red')).toBe(false)
    expect(isUserAvatarId(null)).toBe(false)
  })
})

describe('AvatarPicker', () => {
  it('shows every avatar plus the initial option and reports the choice', async () => {
    const onChange = vi.fn()
    render(<AvatarPicker value="tiger" name="An" onChange={onChange} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(USER_AVATARS.length + 1)
    expect(screen.getByRole('radio', { name: 'Hổ' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Chữ cái đầu/ })).toHaveAttribute('aria-checked', 'false')

    const user = userEvent.setup()
    await user.click(screen.getByRole('radio', { name: 'Gấu trúc' }))
    expect(onChange).toHaveBeenCalledWith('panda')
    await user.click(screen.getByRole('radio', { name: /Chữ cái đầu/ }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('is disabled while saving', () => {
    render(<AvatarPicker value={null} name="An" disabled onChange={() => {}} />)
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled()
  })
})
