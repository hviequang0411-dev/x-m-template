import { parseEnv } from './env'

describe('parseEnv', () => {
  it('accepts a URL and anon key', () => {
    expect(parseEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'k',
    })
  })

  it('throws a helpful error when values are missing', () => {
    expect(() => parseEnv({})).toThrow(/\.env\.example/)
  })

  it('drops any extra variables instead of passing them through', () => {
    const env = parseEnv({ VITE_SUPABASE_URL: 'http://x.test', VITE_SUPABASE_ANON_KEY: 'k', OTHER: 'y' })
    expect(Object.keys(env).sort()).toEqual(['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL'])
  })
})
