import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type EnvGet = (name: string) => string | undefined

/** Reads an env var in Deno without depending on Deno types (keeps this file checkable by tsc). */
function denoEnv(name: string): string | undefined {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno
  return deno?.env.get(name)
}

/**
 * The server-side key. Projects on the legacy keys get SUPABASE_SERVICE_ROLE_KEY; projects on the new
 * API keys get SUPABASE_SECRET_KEYS (a JSON object of named `sb_secret_…` keys, e.g. {"default": "…"}).
 * Both are injected by Supabase into Edge Functions; neither is ever set by hand or sent to the browser.
 */
export function pickServiceKey(get: EnvGet): string {
  const legacy = get('SUPABASE_SERVICE_ROLE_KEY')
  if (legacy) return legacy
  const keys = get('SUPABASE_SECRET_KEYS')
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, unknown>
      const value = typeof parsed.default === 'string' ? parsed.default : Object.values(parsed).find((v) => typeof v === 'string')
      if (typeof value === 'string' && value) return value
    } catch {
      // fall through
    }
  }
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEYS')
}

let client: SupabaseClient | null = null

/**
 * Service-role client: bypasses RLS. SERVER ONLY. The key exists only in Edge Function env and is
 * never exposed through VITE_* variables (ARCHITECTURE §7).
 */
export function serviceClient(): SupabaseClient {
  const url = denoEnv('SUPABASE_URL')
  if (!url) throw new Error('Missing SUPABASE_URL')
  client ??= createClient(url, pickServiceKey(denoEnv), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
