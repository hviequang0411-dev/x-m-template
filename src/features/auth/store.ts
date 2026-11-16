import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'

type AuthStatus = 'loading' | 'signedIn' | 'signedOut'

interface AuthState {
  status: AuthStatus
  session: Session | null
  setSession: (session: Session | null) => void
}

/** Mirrors the Supabase Auth session for routing. Not a source of truth for any game data. */
export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  session: null,
  setSession: (session) => set({ session, status: session ? 'signedIn' : 'signedOut' }),
}))
