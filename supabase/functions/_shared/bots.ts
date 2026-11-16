import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './errors.ts'
import { callRpc } from './rpc.ts'

/**
 * Bot accounts [R36] are ordinary auth users that can never sign in (random password that is never
 * stored, and banned), with profiles.is_bot = true. They are reused: a bot not in any room is idle.
 */
export async function idleOrNewBot(db: SupabaseClient): Promise<string> {
  const idle = await callRpc<string | null>(db, 'idle_bot', {})
  if (idle) return idle
  return createBot(db)
}

export async function createBot(db: SupabaseClient): Promise<string> {
  const { count } = await db.from('profiles').select('id', { count: 'exact', head: true }).eq('is_bot', true)
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const password = crypto.randomUUID() + crypto.randomUUID()
  const { data, error } = await db.auth.admin.createUser({
    email: `bot_${suffix}@bots.xam.invalid`,
    password,
    email_confirm: true,
    ban_duration: '876000h',
    user_metadata: { username: `bot_${suffix}`, display_name: `Máy ${(count ?? 0) + 1}` },
    app_metadata: { bot: true },
  })
  if (error || !data.user) {
    console.error('createBot failed', error)
    throw new ApiError('INTERNAL_ERROR')
  }
  const { error: flagError } = await db.from('profiles').update({ is_bot: true }).eq('id', data.user.id)
  if (flagError) throw new ApiError('INTERNAL_ERROR')
  return data.user.id
}
