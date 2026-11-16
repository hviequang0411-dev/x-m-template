import { useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './store'

/** Keeps the auth store in sync with Supabase Auth. Mount once at the app root. */
export function AuthListener() {
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => data.subscription.unsubscribe()
  }, [setSession])

  return null
}
