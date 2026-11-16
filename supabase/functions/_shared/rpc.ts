import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, mapDbError } from './errors.ts'

/** Calls an RPC and turns its error into an ApiError (P0001 codes, known unique violations). */
export async function callRpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) {
    const code = mapDbError(error)
    if (code === 'INTERNAL_ERROR') console.error(`rpc ${fn} failed`, error)
    throw new ApiError(code)
  }
  return data as T
}
