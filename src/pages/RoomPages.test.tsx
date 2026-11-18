import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useAuthStore } from '@/features/auth/store'
import { useSelectionStore } from '@/features/game/selectionStore'
import { ApiCallError } from '@/lib/functions'
import type { MatchView } from '@/features/match/api'
import type { RoomView } from '@/features/rooms/api'
import { LobbyPage } from './LobbyPage'
import { WaitingRoomPage } from './WaitingRoomPage'
import { GameTablePage } from './GameTablePage'
import { ProfilePage } from './ProfilePage'
import { HistoryPage } from './HistoryPage'
import { AdminPage } from './AdminPage'
import { AppLayout } from './AppLayout'
import { useProfileStore } from '@/features/profile/store'
import { useTopic } from '@/lib/realtime'

const rooms = vi.hoisted(() => ({
  fetchMyActiveRoom: vi.fn(),
  fetchRoom: vi.fn(),
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
  addBot: vi.fn(),
  removeBot: vi.fn(),
}))
const admin = vi.hoisted(() => ({ listUsers: vi.fn(), adjustPoints: vi.fn(), setLocked: vi.fn() }))
vi.mock('@/features/admin/api', () => admin)
vi.mock('@/features/auth/api', () => ({ signOut: vi.fn() }))
const match = vi.hoisted(() => ({
  fetchMatch: vi.fn(),
  fetchMyHand: vi.fn(),
  startMatch: vi.fn(),
  playCards: vi.fn(),
  passTurn: vi.fn(),
  declareSam: vi.fn(),
  claimTimeout: vi.fn(),
  abortMatch: vi.fn(),
  fetchResults: vi.fn(),
  fetchMyHistory: vi.fn(),
}))
vi.mock('@/features/rooms/api', () => rooms)
vi.mock('@/features/match/api', () => match)
const profile = vi.hoisted(() => ({ fetchMyProfile: vi.fn(), updateDisplayName: vi.fn(), updateAvatar: vi.fn() }))
const chatApi = vi.hoisted(() => ({ fetchRoomMessages: vi.fn(), sendRoomMessage: vi.fn() }))
vi.mock('@/features/chat/api', async (orig) => ({ ...(await orig<typeof import('@/features/chat/api')>()), ...chatApi }))
vi.mock('@/features/profile/api', () => profile)
vi.mock('@/lib/realtime', () => ({ useTopic: vi.fn(() => ({ status: 'connected', online: new Set(['u0', 'u1']) })) }))
vi.mock('@/lib/functions', async () => {
  const { API_ERRORS } = await import('@shared/errors.ts')
  class ApiCallError extends Error {
    code: string
    constructor(code: keyof typeof API_ERRORS) {
      super(API_ERRORS[code].message)
      this.code = code
    }
  }
  return { ApiCallError, callFunction: vi.fn() }
})

const ME = 'u0'
const PROFILE = { id: ME, username: 'an', display_name: 'An', total_score: 30, matches_played: 4, matches_won: 1, is_admin: false, is_locked: false }
beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  profile.fetchMyProfile.mockResolvedValue(PROFILE)
  chatApi.fetchRoomMessages.mockResolvedValue([])
  useProfileStore.setState({ profile: null })
  useAuthStore.setState({ status: 'signedIn', session: { user: { id: ME } } as unknown as Session })
  useSelectionStore.setState({ selected: [] })
})

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<LobbyPage />} />
        <Route path="/room/:roomId" element={<WaitingRoomPage />} />
        <Route path="/match/:matchId" element={<GameTablePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route element={<AppLayout />}>
          <Route path="/with-header" element={<p>trang</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  return userEvent.setup()
}

const room = (n: number, hostId = ME): RoomView => ({
  id: 'r1',
  code: 'ABC234',
  status: 'WAITING',
  hostId,
  currentMatchId: null,
  players: Array.from({ length: n }, (_, i) => ({ seat: i, userId: `u${i}`, displayName: `Người ${i}`, isBot: false, points: 10 })),
  waiting: [],
})
const bot = (seat: number) => ({ seat, userId: `bot${seat}`, displayName: `Máy ${seat}`, isBot: true, points: 10 })

describe('Lobby', () => {
  beforeEach(() => rooms.fetchMyActiveRoom.mockResolvedValue(null))

  it('creates a room and opens it', async () => {
    rooms.createRoom.mockResolvedValue({ roomId: 'r1', code: 'ABC234', seat: 0 })
    rooms.fetchRoom.mockResolvedValue(room(1))
    const user = renderAt('/')
    await user.click(await screen.findByRole('button', { name: 'Tạo phòng' }))
    expect(await screen.findByText('Phòng chờ')).toBeInTheDocument()
  })

  it('validates the code locally, then shows the server message', async () => {
    const user = renderAt('/')
    const input = await screen.findByLabelText('Mã phòng')
    await user.type(input, 'ab1')
    await user.click(screen.getByRole('button', { name: 'Vào phòng' }))
    expect(screen.getByText(/Mã phòng gồm 6 ký tự/)).toBeInTheDocument()
    expect(rooms.joinRoom).not.toHaveBeenCalled()

    rooms.joinRoom.mockRejectedValue(new ApiCallError('ROOM_FULL'))
    await user.clear(input)
    await user.type(input, 'abc234')
    expect(input).toHaveValue('ABC234')
    await user.click(screen.getByRole('button', { name: 'Vào phòng' }))
    expect(await screen.findByText('Phòng đã đủ 4 người')).toBeInTheDocument()
    expect(rooms.joinRoom).toHaveBeenCalledWith('ABC234')
  })
})

describe('Waiting room', () => {
  it('alone, the host cannot start but can add a bot [R01b, R36]', async () => {
    rooms.fetchRoom.mockResolvedValue(room(1))
    rooms.addBot.mockResolvedValue({ botId: 'bot1', seat: 1 })
    const user = renderAt('/room/r1')
    expect(await screen.findByRole('button', { name: 'Cần ít nhất 2 người' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Thêm máy' }))
    expect(rooms.addBot).toHaveBeenCalledWith('r1')
  })

  it('the host can start with 2–3 players; the 4th seat shows as free', async () => {
    rooms.fetchRoom.mockResolvedValue(room(3))
    renderAt('/room/r1')
    expect(await screen.findByRole('button', { name: 'Bắt đầu ván (3 người)' })).toBeEnabled()
    expect(screen.getByText('Trống')).toBeInTheDocument()
    expect(screen.getByText(/Ván tính điểm/)).toBeInTheDocument()
  })

  it('a player under 10 points blocks a ranked start, but not a practice match with a bot [R34, R36]', async () => {
    const r = room(2)
    r.players[1]!.points = 4
    rooms.fetchRoom.mockResolvedValue(r)
    renderAt('/room/r1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa đủ: Người 1')
    expect(screen.getByRole('button', { name: 'Bắt đầu ván (2 người)' })).toBeDisabled()
  })

  it('with a bot the match is practice; the host can remove the bot', async () => {
    const r = room(1)
    r.players.push(bot(1))
    rooms.fetchRoom.mockResolvedValue(r)
    rooms.removeBot.mockResolvedValue({ removed: true })
    const user = renderAt('/room/r1')
    expect(await screen.findByText(/ván luyện tập/)).toBeInTheDocument()
    expect(screen.getByText('🤖 Máy 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bắt đầu ván (2 người)' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Bỏ Máy 1' }))
    expect(rooms.removeBot).toHaveBeenCalledWith('r1', 'bot1')
  })

  it('shows the waiting list and tells a waiting member they will get a seat [R37]', async () => {
    const r = room(4, 'u1')
    r.waiting = [{ seat: null, userId: ME, displayName: 'An', isBot: false, points: 10 }]
    r.players = r.players.map((p, i) => ({ ...p, userId: `p${i}` }))
    rooms.fetchRoom.mockResolvedValue({ ...r, hostId: 'p0' })
    renderAt('/room/r1')
    const list = await screen.findByRole('region', { name: 'Hàng chờ' })
    expect(within(list).getByText(/An/)).toHaveTextContent('1. An (bạn)')
    expect(screen.getByText('Bạn đang trong hàng chờ, sẽ được vào ghế khi có chỗ trống.')).toBeInTheDocument()
  })

  it('starting navigates to the table', async () => {
    rooms.fetchRoom.mockResolvedValue(room(4))
    match.startMatch.mockResolvedValue({ matchId: 'm1', version: 1 })
    match.fetchMatch.mockResolvedValue(null)
    match.fetchMyHand.mockResolvedValue([])
    const user = renderAt('/room/r1')
    await user.click(await screen.findByRole('button', { name: 'Bắt đầu ván (4 người)' }))
    expect(match.startMatch).toHaveBeenCalledWith('r1')
    expect(await screen.findByText(/Không tìm thấy ván này/)).toBeInTheDocument()
  })

  it('a guest waits for the host', async () => {
    rooms.fetchRoom.mockResolvedValue(room(4, 'u1'))
    renderAt('/room/r1')
    expect(await screen.findByText('Đang chờ chủ phòng bắt đầu…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bắt đầu/ })).not.toBeInTheDocument()
  })

  it('a playing room redirects to its match', async () => {
    rooms.fetchRoom.mockResolvedValue({ ...room(4), status: 'PLAYING', currentMatchId: 'm9' })
    match.fetchMatch.mockResolvedValue(null)
    match.fetchMyHand.mockResolvedValue([])
    renderAt('/room/r1')
    expect(await screen.findByText(/Không tìm thấy ván này/)).toBeInTheDocument()
    expect(match.fetchMatch).toHaveBeenCalledWith('m9')
  })
})

/** Simulates a broadcast on a room topic the page subscribed to. */
function broadcast(topic: string, event: string, payload: Record<string, unknown>) {
  const call = vi.mocked(useTopic).mock.calls.filter((c) => c[0] === topic).at(-1)
  if (!call) throw new Error(`not subscribed to ${topic}`)
  act(() => call[1](event, payload))
}
const chatPayload = (id: number, userId: string, kind: 'TEXT' | 'EMOTE', body: string) => ({
  id, roomId: 'r1', userId, displayName: `Người ${userId.slice(1)}`, kind, body, createdAt: '2026-11-18T10:00:00Z',
})

describe('Room chat and avatars', () => {
  it('waiting room: shows picked avatars, loads the chat and sends a message', async () => {
    const r = room(2)
    r.players[1]!.avatarId = 'panda'
    rooms.fetchRoom.mockResolvedValue(r)
    chatApi.fetchRoomMessages.mockResolvedValue([chatPayload(1, 'u1', 'TEXT', 'chào An')])
    chatApi.sendRoomMessage.mockResolvedValue(chatPayload(2, 'u0', 'TEXT', 'chào Bình'))
    const user = renderAt('/room/r1')
    const seats = await screen.findByRole('list', { name: 'Chỗ ngồi' })
    expect(seats.querySelector('svg[data-avatar="panda"]')).toBeInTheDocument()
    expect(await screen.findByText('chào An')).toBeInTheDocument()
    expect(chatApi.fetchRoomMessages).toHaveBeenCalledWith('r1')

    await user.type(screen.getByLabelText('Tin nhắn'), 'chào Bình{Enter}')
    expect(chatApi.sendRoomMessage).toHaveBeenCalledWith('r1', 'TEXT', 'chào Bình')
    expect(await screen.findByText('chào Bình')).toBeInTheDocument()
  })

  it('waiting room: a chat broadcast does not refetch the room; an emote pops next to the seat', async () => {
    rooms.fetchRoom.mockResolvedValue(room(2))
    renderAt('/room/r1')
    await screen.findByRole('list', { name: 'Chỗ ngồi' })
    const fetches = rooms.fetchRoom.mock.calls.length
    broadcast('room:r1', 'chat', chatPayload(5, 'u1', 'EMOTE', 'nice'))
    const seats = screen.getByRole('list', { name: 'Chỗ ngồi' })
    expect(within(seats).getByRole('status', { name: 'Người 1: Hay!' })).toBeInTheDocument()
    expect(rooms.fetchRoom.mock.calls.length).toBe(fetches)
  })

  it('a refused message shows the reason', async () => {
    const { ChatError } = await import('@/features/chat/api')
    rooms.fetchRoom.mockResolvedValue(room(2))
    chatApi.sendRoomMessage.mockRejectedValue(new ChatError('RATE_LIMITED'))
    const user = renderAt('/room/r1')
    await user.click(await screen.findByRole('button', { name: 'Gửi biểu cảm: Haha' }))
    expect(chatApi.sendRoomMessage).toHaveBeenCalledWith('r1', 'EMOTE', 'laugh')
    expect(await screen.findByText(/gửi nhanh quá/)).toBeInTheDocument()
  })

  it('game table: bots get a robot avatar, emotes pop next to seats, chat opens with an unread badge', async () => {
    match.fetchMatch.mockResolvedValue({
      matchId: 'm1', roomId: 'r1', hostId: 'u0', turnDeadline: null, ranked: false, version: 3, status: 'PLAYING',
      currentSeat: 0, leadSeat: 0, currentTrick: null, passedSeats: [], winnerSeat: null,
      seats: [
        { seat: 0, userId: 'u0', displayName: 'Người 0', cardCount: 10, hasPlayed: false, status: 'PLAYING', isBot: false, avatarId: 'fox' },
        { seat: 1, userId: 'bot1', displayName: 'Máy 1', cardCount: 10, hasPlayed: false, status: 'PLAYING', isBot: true },
      ],
    } satisfies MatchView)
    match.fetchMyHand.mockResolvedValue(['3S'])
    chatApi.sendRoomMessage.mockResolvedValue(chatPayload(9, 'u0', 'EMOTE', 'gg'))
    const user = renderAt('/match/m1')
    const opponents = await screen.findByRole('list', { name: 'Đối thủ' })
    expect(opponents.querySelector('svg[data-avatar^="bot-"]')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Bài của bạn' }).querySelector('svg[data-avatar="fox"]')).toBeInTheDocument()

    // A quick emote from my seat.
    await user.click(screen.getByRole('button', { name: 'Biểu cảm' }))
    await user.click(screen.getByRole('button', { name: 'Gửi biểu cảm: GG' }))
    expect(chatApi.sendRoomMessage).toHaveBeenCalledWith('r1', 'EMOTE', 'gg')
    expect(await screen.findByRole('status', { name: 'Bạn: GG' })).toBeInTheDocument()

    // Someone else talks while the chat is closed.
    broadcast('room:r1', 'chat', chatPayload(10, 'bot1', 'EMOTE', 'wow'))
    expect(within(opponents).getByRole('status', { name: 'Máy 1: Wow' })).toBeInTheDocument()
    broadcast('room:r1', 'chat', chatPayload(11, 'u3', 'TEXT', 'nhanh lên nào'))
    await user.click(screen.getByRole('button', { name: 'Trò chuyện (2 tin mới)' }))
    expect(screen.getByRole('region', { name: 'Trò chuyện' })).toHaveTextContent('nhanh lên nào')
    await user.click(screen.getByRole('button', { name: 'Đóng trò chuyện' }))
    expect(screen.getByRole('button', { name: 'Trò chuyện' })).toBeInTheDocument()
  })

  it('profile: picking an avatar saves it at once and updates the header', async () => {
    profile.updateAvatar.mockResolvedValue(undefined)
    const user = renderAt('/profile')
    await user.click(await screen.findByRole('radio', { name: 'Cáo' }))
    expect(profile.updateAvatar).toHaveBeenCalledWith(ME, 'fox')
    expect(screen.getByRole('radio', { name: 'Cáo' })).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(profile.fetchMyProfile.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('profile: a failed save puts the previous choice back', async () => {
    profile.fetchMyProfile.mockResolvedValue({ ...PROFILE, avatar_id: 'cat' })
    profile.updateAvatar.mockRejectedValue(new Error('PROFILE_UPDATE_FAILED'))
    const user = renderAt('/profile')
    await user.click(await screen.findByRole('radio', { name: 'Hổ' }))
    expect(await screen.findByText('Không lưu được avatar, vui lòng thử lại')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Mèo may mắn' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('Game table', () => {
  const view = (over: Partial<MatchView> = {}): MatchView => ({
    matchId: 'm1',
    roomId: 'r1',
    hostId: 'u0',
    turnDeadline: null,
    ranked: true,
    version: 5,
    status: 'PLAYING',
    currentSeat: 0,
    leadSeat: 2,
    currentTrick: { type: 'SINGLE', size: 1, keyRank: 7, cards: ['7D'] },
    passedSeats: [1],
    winnerSeat: null,
    seats: [0, 1, 2, 3].map((s) => ({
      seat: s, userId: `u${s}`, displayName: `Người ${s}`, cardCount: 10 - s, hasPlayed: s !== 3, status: 'PLAYING' as const, isBot: false,
    })),
    ...over,
  })

  beforeEach(() => {
    match.fetchMatch.mockResolvedValue(view())
    match.fetchMyHand.mockResolvedValue(['3S', '9H', 'KD'])
  })

  it('lists opponents in CCW order after me and shows the trick', async () => {
    renderAt('/match/m1')
    const opponents = await screen.findByRole('list', { name: 'Đối thủ' })
    expect([...opponents.querySelectorAll('li p:first-child')].map((p) => p.textContent)).toEqual(['Người 3', 'Người 2', 'Người 1'])
    expect(screen.getByRole('img', { name: '7 rô' })).toBeInTheDocument()
    expect(screen.getByText('Đến lượt bạn')).toBeInTheDocument()
  })

  it('plays the selected cards with the current version', async () => {
    match.playCards.mockResolvedValue({ version: 6 })
    const user = renderAt('/match/m1')
    expect(await screen.findByRole('button', { name: 'Đánh' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '9 cơ' }))
    expect(screen.getByText('Lẻ (1 lá)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Đánh' }))
    expect(match.playCards).toHaveBeenCalledWith('m1', 5, ['9H'])
  })

  it('on VERSION_CONFLICT refetches silently and keeps the selection', async () => {
    match.playCards.mockRejectedValue(new ApiCallError('VERSION_CONFLICT'))
    const user = renderAt('/match/m1')
    await user.click(await screen.findByRole('button', { name: '9 cơ' }))
    await user.click(screen.getByRole('button', { name: 'Đánh' }))
    await screen.findByRole('button', { name: 'Đánh' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useSelectionStore.getState().selected).toEqual(['9H'])
    expect(match.fetchMatch.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('shows other server errors in Vietnamese', async () => {
    match.playCards.mockRejectedValue(new ApiCallError('CANNOT_BEAT_CURRENT_PLAY'))
    const user = renderAt('/match/m1')
    await user.click(await screen.findByRole('button', { name: '3 bích' }))
    await user.click(screen.getByRole('button', { name: 'Đánh' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bộ này không chặn được bài trên bàn')
  })

  it('cannot pass when leading, and waits when it is not my turn', async () => {
    match.fetchMatch.mockResolvedValue(view({ currentTrick: null, leadSeat: 0 }))
    renderAt('/match/m1')
    expect(await screen.findByRole('button', { name: 'Bỏ lượt' })).toBeDisabled()
    expect(screen.getByText('Bạn dẫn vòng: đánh bộ bất kỳ')).toBeInTheDocument()
  })

  it('shows the winner, the persisted results and a way back to the room', async () => {
    match.fetchMatch.mockResolvedValue(view({ status: 'FINISHED', winnerSeat: 2 }))
    match.fetchResults.mockResolvedValue([
      { seat: 0, userId: 'u0', displayName: 'Người 0', isWinner: false, remainingCards: 2, remainingHand: ['3S', '4S'], scoreDelta: -2, penalties: {} },
      { seat: 1, userId: 'u1', displayName: 'Người 1', isWinner: false, remainingCards: 10, remainingHand: [], scoreDelta: -15, penalties: { cong: true } },
      { seat: 2, userId: 'u2', displayName: 'Người 2', isWinner: true, remainingCards: 0, remainingHand: [], scoreDelta: 18, penalties: {} },
      { seat: 3, userId: 'u3', displayName: 'Người 3', isWinner: false, remainingCards: 1, remainingHand: ['5S'], scoreDelta: -1, penalties: {} },
    ])
    renderAt('/match/m1')
    expect(await screen.findByText('Người 2 thắng ván này')).toBeInTheDocument()
    const rows = within(await screen.findByRole('table', { name: 'Kết quả ván' })).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('td:last-child')!.textContent)).toEqual(['+18', '-1', '-2', '-15'])
    expect(within(rows[3]!).getByText('Cóng')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về phòng' })).toHaveAttribute('href', '/room/r1')
    expect(screen.queryByRole('button', { name: 'Đánh' })).not.toBeInTheDocument()
  })

  it('an aborted match says no points were scored', async () => {
    match.fetchMatch.mockResolvedValue(view({ status: 'ABORTED' }))
    renderAt('/match/m1')
    expect(await screen.findByText('Ván đã bị huỷ (không tính điểm)')).toBeInTheDocument()
    expect(match.fetchResults).not.toHaveBeenCalled()
  })

  it('the host aborts only after confirming, and sees the server reason', async () => {
    match.abortMatch.mockRejectedValue(new ApiCallError('MATCH_NOT_STALLED'))
    const user = renderAt('/match/m1')
    await user.click(await screen.findByRole('button', { name: 'Huỷ ván…' }))
    expect(match.abortMatch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Huỷ ván' }))
    expect(match.abortMatch).toHaveBeenCalledWith('m1')
    expect(await screen.findByRole('alert')).toHaveTextContent('Chỉ huỷ được ván khi không ai đánh trong 5 phút')
  })

  it('guests have no abort button', async () => {
    match.fetchMatch.mockResolvedValue(view({ hostId: 'u1' }))
    renderAt('/match/m1')
    await screen.findByRole('button', { name: 'Đánh' })
    expect(screen.queryByRole('button', { name: /Huỷ ván/ })).not.toBeInTheDocument()
  })

  it('shows the turn countdown and claims the timeout once the deadline has passed [R27]', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    match.claimTimeout.mockResolvedValue({ version: 6 })
    match.fetchMatch.mockResolvedValue(view({ currentSeat: 3, turnDeadline: new Date(Date.now() - 500).toISOString() }))
    renderAt('/match/m1')
    expect(await screen.findByText('Người 3 còn 0s')).toBeInTheDocument()
    await waitFor(() => expect(match.claimTimeout).toHaveBeenCalledWith('m1', 5), { timeout: 3000 })
  })

  it('shows who is online and the 1-card warning', async () => {
    match.fetchMatch.mockResolvedValue(view({ seats: view().seats.map((s) => (s.seat === 3 ? { ...s, cardCount: 1 } : s)) }))
    renderAt('/match/m1')
    const opponents = await screen.findByRole('list', { name: 'Đối thủ' })
    expect(within(opponents).getAllByLabelText('Đang online')).toHaveLength(1) // u1 (u0 is me)
    expect(within(opponents).getAllByLabelText('Mất kết nối')).toHaveLength(2)
    expect(within(opponents).getByText(/Báo 1/)).toBeInTheDocument()
    expect(screen.getByText('Đã kết nối')).toBeInTheDocument()
  })
})

describe('Profile', () => {
  it('shows persisted stats and saves a new display name', async () => {
    profile.updateDisplayName.mockResolvedValue(undefined)
    const user = renderAt('/profile')
    expect(await screen.findByText('25%')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    const input = screen.getByLabelText('Tên hiển thị')
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled()
    await user.clear(input)
    await user.type(input, '  An Nguyễn ')
    await user.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(profile.updateDisplayName).toHaveBeenCalledWith(ME, 'An Nguyễn')
    expect(await screen.findByText('Đã lưu')).toBeInTheDocument()
  })

  it('rejects an empty name without calling the server', async () => {
    const user = renderAt('/profile')
    await user.clear(await screen.findByLabelText('Tên hiển thị'))
    await user.type(screen.getByLabelText('Tên hiển thị'), ' ')
    await user.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(screen.getByText('Tên hiển thị từ 1 đến 32 ký tự')).toBeInTheDocument()
    expect(profile.updateDisplayName).not.toHaveBeenCalled()
  })
})

describe('History', () => {
  it('lists results newest first with links to each match', async () => {
    match.fetchMyHistory.mockResolvedValue([
      { matchId: 'm2', finishedAt: '2026-11-16T08:00:00Z', roomCode: 'ABC234', isWinner: true, remainingCards: 0, scoreDelta: 45, cong: false },
      { matchId: 'm1', finishedAt: '2026-11-16T07:00:00Z', roomCode: 'ABC234', isWinner: false, remainingCards: 10, scoreDelta: -15, cong: true },
    ])
    renderAt('/history')
    const items = within(await screen.findByRole('list', { name: 'Các ván đã chơi' })).getAllByRole('link')
    expect(items.map((a) => a.getAttribute('href'))).toEqual(['/match/m2', '/match/m1'])
    expect(items[0]).toHaveTextContent('+45')
    expect(items[1]).toHaveTextContent('Cóng')
    expect(items[1]).toHaveTextContent('-15')
  })

  it('has an empty state', async () => {
    match.fetchMyHistory.mockResolvedValue([])
    renderAt('/history')
    expect(await screen.findByText('Bạn chưa chơi ván nào.')).toBeInTheDocument()
  })
})

describe('Game table v2', () => {
  const seats = (n: number, botFrom = n) =>
    Array.from({ length: n }, (_, s) => ({
      seat: s, userId: s >= botFrom ? `bot${s}` : `u${s}`, displayName: s >= botFrom ? `Máy ${s}` : `Người ${s}`,
      cardCount: 10, hasPlayed: true, status: 'PLAYING' as const, isBot: s >= botFrom,
    }))
  const base = (over: Partial<MatchView>): MatchView => ({
    matchId: 'm1', roomId: 'r1', hostId: 'u0', turnDeadline: null, ranked: true, version: 3, status: 'PLAYING',
    currentSeat: 0, leadSeat: 0, currentTrick: null, passedSeats: [], winnerSeat: null, seats: seats(2), ...over,
  })

  beforeEach(() => match.fetchMyHand.mockResolvedValue(['3S', '9H']))

  it('a 2-player match shows one opponent', async () => {
    match.fetchMatch.mockResolvedValue(base({}))
    renderAt('/match/m1')
    const opponents = await screen.findByRole('list', { name: 'Đối thủ' })
    expect(within(opponents).getAllByRole('listitem')).toHaveLength(1)
  })

  it('bots are marked and always shown online', async () => {
    match.fetchMatch.mockResolvedValue(base({ ranked: false, seats: seats(3, 1) }))
    renderAt('/match/m1')
    const opponents = await screen.findByRole('list', { name: 'Đối thủ' })
    expect(within(opponents).getAllByLabelText('Máy')).toHaveLength(2)
    expect(within(opponents).getAllByLabelText('Đang online')).toHaveLength(2)
  })

  it('a waiting member watches without a hand [R37]', async () => {
    match.fetchMatch.mockResolvedValue(base({ seats: seats(2).map((s, i) => ({ ...s, userId: `p${i}` })) }))
    match.fetchMyHand.mockResolvedValue([])
    renderAt('/match/m1')
    expect(await screen.findByText(/Bạn đang xem ván này/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Đánh' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Đối thủ' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('a finished practice match says no points, and loads no results [R36]', async () => {
    match.fetchMatch.mockResolvedValue(base({ status: 'FINISHED', ranked: false, winnerSeat: 1, seats: seats(2, 1) }))
    renderAt('/match/m1')
    expect(await screen.findByText(/Ván luyện tập có máy/)).toBeInTheDocument()
    expect(match.fetchResults).not.toHaveBeenCalled()
  })

  it('a capped loss shows what was owed and what was paid [R35]', async () => {
    match.fetchMatch.mockResolvedValue(base({ status: 'FINISHED', winnerSeat: 0 }))
    match.fetchResults.mockResolvedValue([
      { seat: 0, userId: 'u0', displayName: 'Người 0', isWinner: true, remainingCards: 0, remainingHand: [], scoreDelta: 4, penalties: {} },
      { seat: 1, userId: 'u1', displayName: 'Người 1', isWinner: false, remainingCards: 10, remainingHand: [], scoreDelta: -4, penalties: { cong: true, owed: 15 } },
    ])
    renderAt('/match/m1')
    expect(await screen.findByText('Nợ 15, trả hết 4 điểm đang có')).toBeInTheDocument()
  })

  it('allows declaring Báo Xâm before any card is played and continuing to the next match after finishing', async () => {
    const unplayedSeats = seats(2).map((s) => ({ ...s, hasPlayed: false }))
    match.fetchMatch.mockResolvedValue(base({ seats: unplayedSeats, currentSeat: 1 }))
    match.declareSam.mockResolvedValue({ version: 4 })
    const user = renderAt('/match/m1')
    const samBtn = await screen.findByRole('button', { name: /Báo Xâm/ })
    await user.click(samBtn)
    expect(match.declareSam).toHaveBeenCalledWith('m1', 3)
  })

  it('shows Thối 2 cuối penalty and allows continuing directly to a new match', async () => {
    match.fetchMatch.mockResolvedValue(
      base({ status: 'FINISHED', winnerSeat: 1, foulSeat: 0, endReason: 'THOI_2_CUOI' }),
    )
    match.fetchResults.mockResolvedValue([
      { seat: 0, userId: 'u0', displayName: 'Người 0', isWinner: false, remainingCards: 0, remainingHand: [], scoreDelta: -10, penalties: { thoi2: 1, thoi2Cuoi: true, owed: 15 } },
      { seat: 1, userId: 'u1', displayName: 'Người 1', isWinner: true, remainingCards: 3, remainingHand: ['4S', '5S', '6S'], scoreDelta: 10, penalties: {} },
    ])
    match.startMatch.mockResolvedValue({ matchId: 'm2', version: 1 })
    const user = renderAt('/match/m1')
    expect(await screen.findByText(/đánh cây 2 cuối cùng nên bị xử thua/)).toBeInTheDocument()
    expect(screen.getByText('Thối 2 cuối')).toBeInTheDocument()
    const continueBtn = screen.getByRole('button', { name: 'Tiếp tục ván mới' })
    await user.click(continueBtn)
    expect(match.startMatch).toHaveBeenCalledWith('r1')
  })
})

describe('Header', () => {
  it('shows the player name and points; admins get the admin link', async () => {
    profile.fetchMyProfile.mockResolvedValue({ ...PROFILE, total_score: 42, is_admin: true })
    renderAt('/with-header')
    const account = await screen.findByLabelText('Tài khoản')
    expect(account).toHaveTextContent('An')
    expect(await within(account).findByText('42 điểm')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Quản trị' })).toHaveAttribute('href', '/admin')
  })

  it('players without the flag see no admin link; a locked account sees a banner', async () => {
    profile.fetchMyProfile.mockResolvedValue({ ...PROFILE, is_locked: true })
    renderAt('/with-header')
    expect(await screen.findByText(/Tài khoản của bạn đang bị khoá/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Quản trị' })).not.toBeInTheDocument()
  })

  it('toggles sound in header and persists to localStorage, and toggles mobile menu', async () => {
    const user = renderAt('/with-header')
    const soundBtn = await screen.findByRole('button', { name: 'Âm thanh' })
    const initialPressed = soundBtn.getAttribute('aria-pressed')
    await user.click(soundBtn)
    const nextPressed = initialPressed === 'true' ? 'false' : 'true'
    expect(soundBtn).toHaveAttribute('aria-pressed', nextPressed)
    expect(window.localStorage.getItem('xam_sound_enabled')).toBe(nextPressed)

    const menuBtn = screen.getByRole('button', { name: 'Menu' })
    expect(menuBtn).toHaveAttribute('aria-expanded', 'false')
    await user.click(menuBtn)
    expect(menuBtn).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('Admin page [R38]', () => {
  const users = [
    { id: 'x1', username: 'binh', display_name: 'Bình', email: 'binh@xam.test', total_score: 3, matches_played: 2, matches_won: 0, is_admin: false, is_locked: false, created_at: '2026-11-17T00:00:00Z' },
  ]

  it('refuses non-admins', async () => {
    useProfileStore.setState({ profile: PROFILE })
    renderAt('/admin')
    expect(await screen.findByText('Bạn không có quyền quản trị.')).toBeInTheDocument()
    expect(admin.listUsers).not.toHaveBeenCalled()
  })

  it('lists accounts and adjusts points with a reason', async () => {
    useProfileStore.setState({ profile: { ...PROFILE, is_admin: true } })
    admin.listUsers.mockResolvedValue(users)
    admin.adjustPoints.mockResolvedValue({ balance: 23 })
    const user = renderAt('/admin')
    const row = await screen.findByText('binh@xam.test')
    expect(row).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cộng/trừ điểm' }))
    await user.type(screen.getByLabelText('Số điểm (+/-)'), 'abc')
    await user.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập số điểm nguyên khác 0')
    await user.clear(screen.getByLabelText('Số điểm (+/-)'))
    await user.type(screen.getByLabelText('Số điểm (+/-)'), '20')
    await user.type(screen.getByLabelText('Lý do'), 'Thưởng beta')
    await user.click(screen.getByRole('button', { name: 'Lưu' }))
    expect(admin.adjustPoints).toHaveBeenCalledWith('x1', 20, 'Thưởng beta')
    expect(await screen.findByText('Đã cộng 20 điểm cho Bình')).toBeInTheDocument()
  })

  it('locks an account after confirming', async () => {
    useProfileStore.setState({ profile: { ...PROFILE, is_admin: true } })
    admin.listUsers.mockResolvedValue(users)
    admin.setLocked.mockResolvedValue({ locked: true })
    const user = renderAt('/admin')
    await user.click(await screen.findByRole('button', { name: 'Khoá tài khoản' }))
    expect(admin.setLocked).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Khoá' }))
    expect(admin.setLocked).toHaveBeenCalledWith('x1', true)
  })
})
