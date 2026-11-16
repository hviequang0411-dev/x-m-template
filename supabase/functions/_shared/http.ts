import type { z } from 'zod'
import { API_ERRORS, ApiError, errorEnvelope, type ApiErrorCode } from './errors.ts'

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(code: ApiErrorCode): Response {
  return json(errorEnvelope(code), API_ERRORS[code].status)
}

/** Parses the JSON body with a Zod schema, or throws INVALID_REQUEST. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown
  try {
    const text = await req.text()
    raw = text ? JSON.parse(text) : {}
  } catch {
    throw new ApiError('INVALID_REQUEST')
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw new ApiError('INVALID_REQUEST')
  return parsed.data
}

/**
 * Wraps a handler: CORS preflight, POST only, one error envelope.
 * Unexpected errors are logged and returned as INTERNAL_ERROR (no stack traces to clients).
 */
export function handler(fn: (req: Request) => Promise<unknown>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED')
    try {
      return json({ ok: true, ...((await fn(req)) as object) })
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e.code)
      console.error(e)
      return errorResponse('INTERNAL_ERROR')
    }
  }
}
