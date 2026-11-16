import { supabase } from '@/lib/supabase'
import type { LoginInput, RegisterInput } from './schemas'
import { authErrorMessage } from './errors'

export type AuthResult = { ok: true } | { ok: false; message: string }

export async function signIn(input: LoginInput): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword(input)
  return error ? { ok: false, message: authErrorMessage(error) } : { ok: true }
}

export async function signUp(input: RegisterInput): Promise<AuthResult> {
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    // Read by the handle_new_user trigger, which validates them again server-side.
    options: { data: { username: input.username, display_name: input.displayName } },
  })
  return error ? { ok: false, message: authErrorMessage(error) } : { ok: true }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
