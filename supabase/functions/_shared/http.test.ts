import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError } from './errors.ts'
import { handler, parseBody } from './http.ts'

const post = (body: string) => new Request('http://x/fn', { method: 'POST', body })

describe('handler', () => {
  it('answers CORS preflight', async () => {
    const res = await handler(async () => ({}))(new Request('http://x/fn', { method: 'OPTIONS' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('rejects non-POST methods', async () => {
    const res = await handler(async () => ({}))(new Request('http://x/fn', { method: 'GET' }))
    expect(res.status).toBe(405)
    expect(await res.json()).toMatchObject({ ok: false, error: { code: 'METHOD_NOT_ALLOWED' } })
  })

  it('wraps success as { ok: true, ...result }', async () => {
    const res = await handler(async () => ({ version: 3 }))(post('{}'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, version: 3 })
  })

  it('maps ApiError to its status and envelope', async () => {
    const res = await handler(async () => {
      throw new ApiError('ROOM_FULL')
    })(post('{}'))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ ok: false, error: { code: 'ROOM_FULL', message: 'Phòng đã đủ 5 người' } })
  })

  it('hides unexpected errors behind INTERNAL_ERROR', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handler(async () => {
      throw new Error('secret stack detail')
    })(post('{}'))
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).toContain('INTERNAL_ERROR')
    expect(body).not.toContain('secret')
    expect(log).toHaveBeenCalled()
  })
})

describe('parseBody', () => {
  const schema = z.object({ a: z.number() }).strict()

  it('parses a valid body', async () => {
    expect(await parseBody(post('{"a":1}'), schema)).toEqual({ a: 1 })
  })

  it.each(['not json', '{"a":"x"}', '{"a":1,"b":2}', '[]'])('rejects %s as INVALID_REQUEST', async (body) => {
    await expect(parseBody(post(body), schema)).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })
})
