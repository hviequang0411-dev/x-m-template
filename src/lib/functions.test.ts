import { ApiCallError, callFunction } from './functions'

vi.mock('./supabase', () => ({
  env: { VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'anon' },
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}))

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('callFunction', () => {
  it('posts with the user JWT and returns the success body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, roomId: 'r1' }))
    await expect(callFunction('create-room', {}, fetchMock)).resolves.toEqual({ ok: true, roomId: 'r1' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:54321/functions/v1/create-room')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt')
  })

  it('throws ApiCallError with the server code and message', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(409, { ok: false, error: { code: 'ROOM_FULL', message: 'Phòng đã đủ 5 người' } }))
    const err = await callFunction('join-room', { code: 'ABCDEF' }, fetchMock).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiCallError)
    expect(err).toMatchObject({ code: 'ROOM_FULL', message: 'Phòng đã đủ 5 người' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a dropped request once with the same body', async () => {
    const bodies: string[] = []
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_u: string, init: RequestInit) => {
        bodies.push(init.body as string)
        return new Response('worker retired', { status: 503 })
      })
      .mockImplementationOnce(async (_u: string, init: RequestInit) => {
        bodies.push(init.body as string)
        return jsonResponse(200, { ok: true, version: 2 })
      })
    await expect(callFunction('play-cards', { actionId: 'a1', cards: ['3S'] }, fetchMock)).resolves.toMatchObject({ version: 2 })
    expect(bodies).toHaveLength(2)
    expect(bodies[0]).toBe(bodies[1])
  })

  it('retries a network error once, then gives up with INTERNAL_ERROR', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(callFunction('pass-turn', {}, fetchMock)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-envelope 4xx', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(401, { code: 'UNAUTHORIZED_NO_AUTH_HEADER' }))
    await expect(callFunction('create-room', {}, fetchMock)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
