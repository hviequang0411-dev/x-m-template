import { render, screen } from '@testing-library/react'
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

const rooms = vi.hoisted(() => ({
  fetchMyActiveRoom: vi.fn(),
  fetchRoom: vi.fn(),
  createRoom: vi.fn(),
  joinRoom: vi.fn(),
  leaveRoom: vi.fn(),
}))
const match = vi.hoisted(() => ({
  fetchMatch: vi.fn(),
  fetchMyHand: vi.fn(),
  startMatch: vi.fn(),
  playCards: vi.fn(),
  passTurn: vi.fn(),
}))
vi.mock('@/features/rooms/api', () => rooms)
vi.mock('@/features/match/api', () => match)
vi.mock('@/features/profile/api', () => ({ fetchMyProfile: vi.fn(async () => ({ display_name: 'An', total_score: 0, matches_played: 0, matches_won: 0 })) }))
vi.mock('@/lib/realtime', () => ({ useTopic: vi.fn() }))
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
beforeEach(() => {
  vi.clearAllMocks()
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
  players: Array.from({ length: n }, (_, i) => ({ seat: i, userId: `u${i}`, displayName: `Người ${i}` })),
})

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
  it('the host can start only with 4 players', async () => {
    rooms.fetchRoom.mockResolvedValue(room(3))
    renderAt('/room/r1')
    expect(await screen.findByRole('button', { name: 'Chờ đủ người (3/4)' })).toBeDisabled()
    expect(screen.getByText('Trống')).toBeInTheDocument()
  })

  it('starting navigates to the table', async () => {
    rooms.fetchRoom.mockResolvedValue(room(4))
    match.startMatch.mockResolvedValue({ matchId: 'm1', version: 1 })
    match.fetchMatch.mockResolvedValue(null)
    match.fetchMyHand.mockResolvedValue([])
    const user = renderAt('/room/r1')
    await user.click(await screen.findByRole('button', { name: 'Bắt đầu ván' }))
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

describe('Game table', () => {
  const view = (over: Partial<MatchView> = {}): MatchView => ({
    matchId: 'm1',
    roomId: 'r1',
    version: 5,
    status: 'PLAYING',
    currentSeat: 0,
    leadSeat: 2,
    currentTrick: { type: 'SINGLE', size: 1, keyRank: 7, cards: ['7D'] },
    passedSeats: [1],
    winnerSeat: null,
    seats: [0, 1, 2, 3].map((s) => ({
      seat: s, userId: `u${s}`, displayName: `Người ${s}`, cardCount: 10 - s, hasPlayed: s !== 3, status: 'PLAYING' as const,
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

  it('shows the winner and a way back to the room', async () => {
    match.fetchMatch.mockResolvedValue(view({ status: 'FINISHED', winnerSeat: 2 }))
    renderAt('/match/m1')
    expect(await screen.findByText('Người 2 thắng ván này')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Về phòng' })).toHaveAttribute('href', '/room/r1')
    expect(screen.queryByRole('button', { name: 'Đánh' })).not.toBeInTheDocument()
  })
})
