import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface LocalEnv {
  url: string
  anonKey: string
  serviceKey: string
}

let cached: LocalEnv | null = null

/** Reads URL and keys from the running local stack. Refuses anything that isn't localhost. */
export function localEnv(): LocalEnv {
  if (cached) return cached
  const out = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const get = (k: string) => {
    const m = new RegExp(`^${k}="?([^"\\n]+)"?`, 'm').exec(out)
    if (!m) throw new Error(`${k} missing from supabase status (is the local stack running?)`)
    return m[1]!
  }
  const url = get('API_URL')
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error(`Refusing non-local API_URL ${url}`)
  cached = { url, anonKey: get('ANON_KEY'), serviceKey: get('SERVICE_ROLE_KEY') }
  return cached
}

export function adminClient(): SupabaseClient {
  const { url, serviceKey } = localEnv()
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export interface Player {
  userId: string
  token: string
  client: SupabaseClient
  username: string
}

const PASSWORD = `it-${randomUUID()}`

/** Creates a confirmed throwaway user and signs them in with their own anon client. */
export async function newPlayer(): Promise<Player> {
  const { url, anonKey } = localEnv()
  const username = `it_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const { data, error } = await adminClient().auth.admin.createUser({
    email: `${username}@xam.test`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { username, display_name: username },
  })
  if (error || !data.user) throw error ?? new Error('createUser failed')
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: session, error: signInError } = await client.auth.signInWithPassword({
    email: `${username}@xam.test`,
    password: PASSWORD,
  })
  if (signInError || !session.session) throw signInError ?? new Error('signIn failed')
  return { userId: data.user.id, token: session.session.access_token, client, username }
}

export async function newPlayers(n: number): Promise<Player[]> {
  return Promise.all(Array.from({ length: n }, newPlayer))
}

export interface FnResponse<T = Record<string, unknown>> {
  status: number
  body: ({ ok: true } & T) | { ok: false; error: { code: string; message: string } }
}

/** Requests the local edge runtime dropped (worker recycled mid-request) and that were retried. */
export const dropped: { fn: string; status: number }[] = []

/**
 * Calls an Edge Function as `player` and returns status + parsed envelope.
 * Like the frontend, it retries once (same body, so the same actionId) when the runtime answers
 * with a non-envelope 5xx: game actions are idempotent, so a retry is always safe.
 */
export async function call<T = Record<string, unknown>>(
  player: Player,
  fn: string,
  body: unknown,
): Promise<FnResponse<T>> {
  const first = await callOnce<T>(player, fn, body)
  if (first.status >= 500 && errorCode(first)?.startsWith('NON_ENVELOPE')) {
    dropped.push({ fn, status: first.status })
    return callOnce<T>(player, fn, body)
  }
  return first
}

async function callOnce<T>(player: Player, fn: string, body: unknown): Promise<FnResponse<T>> {
  const { url, anonKey } = localEnv()
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${player.token}`, apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  // Anything that isn't our envelope (gateway or runtime error) is surfaced as a pseudo-code.
  const isEnvelope =
    typeof parsed === 'object' && parsed !== null && 'ok' in parsed &&
    ((parsed as { ok: unknown }).ok === true || typeof (parsed as { error?: { code?: unknown } }).error?.code === 'string')
  if (!isEnvelope)
    return { status: res.status, body: { ok: false, error: { code: `NON_ENVELOPE_${res.status}`, message: text.slice(0, 300) } } }
  return { status: res.status, body: parsed as FnResponse<T>['body'] }
}

export function errorCode(r: FnResponse<unknown>): string | null {
  return r.body.ok ? null : r.body.error.code
}

export function okBody<T>(r: FnResponse<T>): { ok: true } & T {
  if (!r.body.ok) throw new Error(`expected ok, got ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

/** A full room: host creates, three others join. Returns players in seat order. */
export async function fullRoom(): Promise<{ roomId: string; code: string; players: Player[] }> {
  const players = await newPlayers(4)
  const created = okBody(await call<{ roomId: string; code: string }>(players[0]!, 'create-room', {}))
  for (const p of players.slice(1)) okBody(await call(p, 'join-room', { code: created.code }))
  return { roomId: created.roomId, code: created.code, players }
}

export interface PublicState {
  matchId: string
  roomId: string
  version: number
  status: 'PLAYING' | 'FINISHED' | 'ABORTED'
  currentSeat: number
  leadSeat: number
  currentTrick: { type: string; cards: string[] } | null
  passedSeats: number[]
  winnerSeat: number | null
  seats: { seat: number; userId: string; cardCount: number; hasPlayed: boolean }[]
}

export async function myHand(player: Player, matchId: string): Promise<string[]> {
  const { data, error } = await player.client
    .from('player_private_states')
    .select('hand')
    .eq('match_id', matchId)
    .single()
  if (error) throw error
  return data.hand as string[]
}
