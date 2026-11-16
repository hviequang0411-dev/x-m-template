import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from './errors.ts'

/** Verifies the caller's JWT with Supabase Auth and returns their user id, or throws UNAUTHORIZED. */
export async function requireUserId(req: Request, db: SupabaseClient): Promise<string> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new ApiError('UNAUTHORIZED')
  const { data, error } = await db.auth.getUser(token)
  if (error || !data.user) throw new ApiError('UNAUTHORIZED')
  return data.user.id
}
