import { describe, expect, it } from 'vitest'
import { pickServiceKey } from './db.ts'

const env = (vars: Record<string, string>) => (name: string) => vars[name]

describe('pickServiceKey', () => {
  it('uses the legacy service-role key when present (local stack, older projects)', () => {
    expect(pickServiceKey(env({ SUPABASE_SERVICE_ROLE_KEY: 'eyJlegacy', SUPABASE_SECRET_KEYS: '{"default":"sb_secret_x"}' }))).toBe('eyJlegacy')
  })

  it('falls back to the default new secret key', () => {
    expect(pickServiceKey(env({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_abc"}' }))).toBe('sb_secret_abc')
  })

  it('uses any named secret key when there is no "default"', () => {
    expect(pickServiceKey(env({ SUPABASE_SECRET_KEYS: '{"server":"sb_secret_def"}' }))).toBe('sb_secret_def')
  })

  it('fails loudly when no key is available or the JSON is broken', () => {
    expect(() => pickServiceKey(env({}))).toThrow(/Missing/)
    expect(() => pickServiceKey(env({ SUPABASE_SECRET_KEYS: 'not json' }))).toThrow(/Missing/)
  })
})
