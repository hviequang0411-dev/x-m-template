import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Integration tests against the LOCAL Supabase stack (`npm run db:start` + `supabase functions serve`).
 * Run with `npm run test:integration`. They create throwaway users with @xam.test emails.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@engine': r('./supabase/functions/_shared/game-engine'),
      '@shared': r('./supabase/functions/_shared'),
      '@': r('./src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
