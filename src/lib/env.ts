import { z } from 'zod'

/**
 * Only public values may appear here. Vite inlines every VITE_* variable into
 * the browser bundle, so the service-role key must never be one of them.
 */
const EnvSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
})

export type PublicEnv = z.infer<typeof EnvSchema>

export function parseEnv(raw: Record<string, unknown>): PublicEnv {
  const result = EnvSchema.safeParse(raw)
  if (!result.success) {
    throw new Error(
      'Missing or invalid Supabase env. Copy .env.example to .env.local and fill in values from `npx supabase status`.',
    )
  }
  return result.data
}
