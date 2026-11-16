import { supabase } from '@/lib/supabase'
import { PROFILE_SELECT } from '@/features/queries'

export interface Profile {
  id: string
  username: string
  display_name: string
  total_score: number
  matches_played: number
  matches_won: number
  is_admin: boolean
  is_locked: boolean
}

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error('PROFILE_LOAD_FAILED')
  return data
}

/** Only display_name (and avatar_url) are writable by the owner (column grant + RLS). */
export async function updateDisplayName(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ display_name: displayName }).eq('id', userId)
  if (error) throw new Error('PROFILE_UPDATE_FAILED')
}
