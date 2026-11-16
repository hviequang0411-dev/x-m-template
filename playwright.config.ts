import { defineConfig, devices } from '@playwright/test'

// Browsers are installed inside node_modules (`PLAYWRIGHT_BROWSERS_PATH=0`, see README) so they don't
// use space on the system drive. Workers inherit this.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0'

/**
 * End-to-end tests against the LOCAL stack: `npm run db:start` must be running; the Vite dev
 * server is started (or reused) automatically and reads `.env.local`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'vi-VN',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
