import { supabase } from '@/lib/supabase'

export interface Profile {
  id: string
  username: string
  display_name: string
  total_score: number
  matches_played: number
  matches_won: number
}

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, total_score, matches_played, matches_won')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error('PROFILE_LOAD_FAILED')
  return data
}
