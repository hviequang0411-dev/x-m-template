import { API_ERRORS, isApiErrorCode, type ApiErrorCode } from '@shared/errors.ts'
import { env, supabase } from './supabase'

/** An error envelope from an Edge Function, with the server's Vietnamese message. */
export class ApiCallError extends Error {
  readonly code: ApiErrorCode
  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? API_ERRORS[code].message)
    this.name = 'ApiCallError'
    this.code = code
  }
}

type FetchLike = typeof fetch

async function once(name: string, body: unknown, token: string, fetchImpl: FetchLike) {
  const res = await fetchImpl(`${env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    // not JSON: a gateway/runtime error
  }
  return { status: res.status, parsed }
}

/**
 * Calls an Edge Function and returns its result, or throws ApiCallError.
 * A dropped request (network error, or a 5xx that isn't our envelope) is retried once with the
 * SAME body, so game actions keep their actionId and the retry is idempotent on the server.
 */
export async function callFunction<T>(name: string, body: unknown, fetchImpl: FetchLike = fetch): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiCallError('UNAUTHORIZED')

  for (let attempt = 0; attempt < 2; attempt++) {
    let result: Awaited<ReturnType<typeof once>> | null
    try {
      result = await once(name, body, token, fetchImpl)
    } catch {
      result = null // network error
    }
    const envelope = result?.parsed as { ok?: unknown; error?: { code?: unknown; message?: unknown } } | null
    if (envelope?.ok === true) return envelope as T
    if (envelope?.ok === false && isApiErrorCode(envelope.error?.code))
      throw new ApiCallError(
        envelope.error.code,
        typeof envelope.error.message === 'string' ? envelope.error.message : undefined,
      )
    if (result && result.status === 401) throw new ApiCallError('UNAUTHORIZED')
    if (result && result.status < 500) break
  }
  throw new ApiCallError('INTERNAL_ERROR')
}
