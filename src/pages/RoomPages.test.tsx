import { render, screen, waitFor, within } from '@testing-library/react'
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
  claimTimeout: vi.fn(),
  abortMatch: vi.fn(),
  fetchResults: vi.fn(),
  fetchMyHistory: vi.fn(),
}))
vi.mock('@/features/rooms/api', () => rooms)
vi.mock('@/features/match/api', () => match)
const profile = vi.hoisted(() => ({ fetchMyProfile: vi.fn(), updateDisplayName: vi.fn() }))
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
beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  profile.fetchMyProfile.mockResolvedValue({ id: ME, username: 'an', display_name: 'An', total_score: 30, matches_played: 4, matches_won: 1 })
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
    hostId: 'u0',
    turnDeadline: null,
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
