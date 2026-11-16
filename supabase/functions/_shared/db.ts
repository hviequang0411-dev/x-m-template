import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** Reads an env var in Deno without depending on Deno types (keeps this file checkable by tsc). */
function env(name: string): string {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno
  const value = deno?.env.get(name)
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

let client: SupabaseClient | null = null

/**
 * Service-role client: bypasses RLS. SERVER ONLY. It exists only in Edge Function secrets and
 * is never exposed through VITE_* variables (ARCHITECTURE §7).
 */
export function serviceClient(): SupabaseClient {
  client ??= createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
