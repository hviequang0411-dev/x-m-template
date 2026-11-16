import { create } from 'zustand'
import { fetchMyProfile, type Profile } from './api'

interface ProfileState {
  /** The signed-in user's profile (name, points balance, admin flag). Display only. */
  profile: Profile | null
  refresh: (userId: string) => Promise<void>
  clear: () => void
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  refresh: async (userId) => {
    try {
      const profile = await fetchMyProfile(userId)
      set({ profile })
    } catch {
      // Keep the last known value; the header is not critical.
    }
  },
  clear: () => set({ profile: null }),
}))
