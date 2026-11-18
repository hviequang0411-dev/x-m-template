import { supabase } from '@/lib/supabase'
import { toInternalEmail, toInternalUsername, type LoginInput, type RegisterInput } from './schemas'
import { authErrorMessage } from './errors'

export type AuthResult = { ok: true } | { ok: false; message: string }

export async function signIn(input: LoginInput): Promise<AuthResult> {
  const { error } = await supabase.auth.signInWithPassword({
    email: toInternalEmail(input.username),
    password: input.password,
  })
  return error ? { ok: false, message: authErrorMessage(error) } : { ok: true }
}

export async function signUp(input: RegisterInput): Promise<AuthResult> {
  const internalUsername = toInternalUsername(input.username)
  const { error } = await supabase.auth.signUp({
    email: toInternalEmail(input.username),
    password: input.password,
    // Read by the handle_new_user trigger, which validates them again server-side.
    options: { data: { username: internalUsername, display_name: input.displayName || input.username } },
  })
  return error ? { ok: false, message: authErrorMessage(error) } : { ok: true }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
