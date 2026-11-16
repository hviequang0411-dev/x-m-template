import { callFunction } from '@/lib/functions'

export interface AdminUser {
  id: string
  username: string
  display_name: string
  email: string
  total_score: number
  matches_played: number
  matches_won: number
  is_admin: boolean
  is_locked: boolean
  created_at: string
}

/** Admin-only (checked on the server); returns emails, which normal players can't read. */
export async function listUsers(query: string): Promise<AdminUser[]> {
  const r = await callFunction<{ users: AdminUser[] }>('admin-users', { query })
  return r.users
}

export const adjustPoints = (userId: string, delta: number, reason: string) =>
  callFunction<{ balance: number }>('admin-adjust-points', { userId, delta, reason })

export const setLocked = (userId: string, locked: boolean) =>
  callFunction<{ locked: boolean }>('admin-set-locked', { userId, locked })
