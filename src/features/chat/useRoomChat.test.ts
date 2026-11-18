import { act, renderHook, waitFor } from '@testing-library/react'
import { EMOTE_BUBBLE_MS, useRoomChat } from './useRoomChat'

const api = vi.hoisted(() => ({ fetchRoomMessages: vi.fn(), sendRoomMessage: vi.fn() }))
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), ...api }))

const payload = (id: number, kind: 'TEXT' | 'EMOTE', body: string, userId = 'u1', roomId = 'r1') => ({
  id,
  roomId,
  userId,
  displayName: 'Bình',
  kind,
  body,
  createdAt: '2026-11-18T10:00:00Z',
})

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchRoomMessages.mockResolvedValue([])
})
afterEach(() => vi.useRealTimers())

describe('useRoomChat', () => {
  it('loads the history of the room', async () => {
    api.fetchRoomMessages.mockResolvedValue([payload(1, 'TEXT', 'cũ')])
    const { result } = renderHook(() => useRoomChat('r1'))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(api.fetchRoomMessages).toHaveBeenCalledWith('r1')
  })

  it('adds broadcasts once, in id order, and ignores other rooms and junk', async () => {
    const { result } = renderHook(() => useRoomChat('r1'))
    await waitFor(() => expect(api.fetchRoomMessages).toHaveBeenCalled())
    act(() => {
      result.current.receive(payload(3, 'TEXT', 'ba'))
      result.current.receive(payload(2, 'TEXT', 'hai'))
      result.current.receive(payload(3, 'TEXT', 'ba'))
      result.current.receive(payload(4, 'TEXT', 'phòng khác', 'u1', 'r2'))
      result.current.receive({ hello: 'world' })
    })
    expect(result.current.messages.map((m) => m.body)).toEqual(['hai', 'ba'])
  })

  it('an emote shows a bubble next to its sender for a few seconds', async () => {
    const { result } = renderHook(() => useRoomChat('r1'))
    await waitFor(() => expect(api.fetchRoomMessages).toHaveBeenCalled())
    vi.useFakeTimers()
    act(() => result.current.receive(payload(5, 'EMOTE', 'wow')))
    expect(result.current.bubbles.u1).toEqual({ code: 'wow', key: 5 })
    act(() => vi.advanceTimersByTime(EMOTE_BUBBLE_MS - 100))
    expect(result.current.bubbles.u1).toBeDefined()
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.bubbles.u1).toBeUndefined()
  })

  it('history does not replay old emote bubbles', async () => {
    api.fetchRoomMessages.mockResolvedValue([payload(1, 'EMOTE', 'gg')])
    const { result } = renderHook(() => useRoomChat('r1'))
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.bubbles).toEqual({})
  })

  it('remembers how far the first history load went (for unread counts)', async () => {
    api.fetchRoomMessages.mockResolvedValue([payload(4, 'TEXT', 'a'), payload(9, 'TEXT', 'b')])
    const { result } = renderHook(() => useRoomChat('r1'))
    expect(result.current.historyUpToId).toBe(0)
    await waitFor(() => expect(result.current.historyUpToId).toBe(9))
    api.fetchRoomMessages.mockResolvedValue([payload(12, 'TEXT', 'c')])
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.messages).toHaveLength(3))
    expect(result.current.historyUpToId).toBe(9)
  })

  it('sending adds the message (the later broadcast is not duplicated)', async () => {
    api.sendRoomMessage.mockResolvedValue(payload(7, 'TEXT', 'xin chào', 'u0'))
    const { result } = renderHook(() => useRoomChat('r1'))
    await waitFor(() => expect(api.fetchRoomMessages).toHaveBeenCalled())
    let ok = false
    await act(async () => {
      ok = await result.current.sendText('xin chào')
    })
    expect(ok).toBe(true)
    expect(api.sendRoomMessage).toHaveBeenCalledWith('r1', 'TEXT', 'xin chào')
    act(() => result.current.receive(payload(7, 'TEXT', 'xin chào', 'u0')))
    expect(result.current.messages).toHaveLength(1)
  })

  it('a refused send reports the server reason in Vietnamese', async () => {
    const { ChatError } = await import('./api')
    api.sendRoomMessage.mockRejectedValue(new ChatError('RATE_LIMITED'))
    const { result } = renderHook(() => useRoomChat('r1'))
    let ok = true
    await act(async () => {
      ok = await result.current.sendEmote('hurry')
    })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('Bạn gửi nhanh quá, chờ vài giây rồi gửi tiếp nhé.')
  })

  it('without a room it does nothing', async () => {
    const { result } = renderHook(() => useRoomChat(null))
    expect(await result.current.sendText('x')).toBe(false)
    expect(api.fetchRoomMessages).not.toHaveBeenCalled()
  })
})
