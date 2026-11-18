#!/usr/bin/env node
// Captures the main screens at desktop and phone width with a headless browser, against the LOCAL stack
// and dev server. Creates throwaway @xam.test accounts and practice rooms with bots.
//
//   node scripts/ui-screens.mjs <out-dir>          e.g. screenshots/before
//
// Needs: `npm run db:start`, `npm run dev`, and Chromium (`PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium`).
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0'
const { chromium } = await import('@playwright/test')
const { createClient } = await import('@supabase/supabase-js')

const OUT = process.argv[2] ?? 'screenshots/latest'
const APP = 'http://localhost:5173'
mkdirSync(OUT, { recursive: true })

const env = execSync('npx supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const get = (k) => new RegExp(`^${k}="?([^"\\n]+)"?`, 'm').exec(env)[1]
const API = get('API_URL')
if (!/^http:\/\/127\.0\.0\.1:/.test(API)) throw new Error('local stack only')
const admin = createClient(API, get('SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

const SIZES = { desktop: { width: 1280, height: 860 }, mobile: { width: 375, height: 812 } }
const PASSWORD = `ui-${randomUUID()}`
const browser = await chromium.launch()
const shots = []

async function shot(page, name) {
  for (const [label, size] of Object.entries(SIZES)) {
    await page.setViewportSize(size)
    await page.waitForTimeout(350)
    const file = join(OUT, `${name}-${label}.png`)
    await page.screenshot({ path: file, fullPage: true })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    shots.push(`${file}${overflow ? '  ⚠ horizontal overflow' : ''}`)
  }
  await page.setViewportSize(SIZES.desktop)
}

async function newUser(tag) {
  const context = await browser.newContext({ viewport: SIZES.desktop, locale: 'vi-VN' })
  const page = await context.newPage()
  const id = randomUUID().replace(/-/g, '').slice(0, 8)
  const uname = `ui_${tag.toLowerCase()}_${id}`
  await page.goto(`${APP}/register`)
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(uname)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(`Minh ${tag}`)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await page.getByText(`Xin chào, Minh ${tag}`).waitFor()
  const { data } = await admin.from('profiles').select('id').eq('username', uname).single()
  return { page, userId: data.id }
}

/** Creates a room, adds `bots` bots, starts, and waits until it is the human's turn. */
async function tableWith(tag, bots) {
  const { page, userId } = await newUser(tag)
  await page.getByRole('button', { name: 'Tạo phòng' }).click()
  await page.getByText('Phòng chờ').waitFor()
  for (let i = 0; i < bots; i++) {
    await page.getByRole('button', { name: 'Thêm máy' }).click()
    await page.waitForFunction((n) => document.querySelectorAll('[aria-label="Chỗ ngồi"] li').length >= 1 && [...document.querySelectorAll('[aria-label="Chỗ ngồi"] li')].filter((li) => li.textContent.includes('🤖')).length >= n, i + 1)
  }
  return { page, userId }
}

async function startAndWaitMyTurn(page, players) {
  await page.getByRole('button', { name: `Bắt đầu ván (${players} người)` }).click()
  await page.waitForURL(/\/match\//)
  await page.getByText('Đến lượt bạn', { exact: true }).waitFor({ timeout: 30_000 })
}

/** Lead the lowest card / pass, until the result shows. */
async function playOut(page) {
  for (let i = 0; i < 120; i++) {
    if (await page.getByRole('region', { name: 'Kết quả' }).isVisible()) return
    const mine = page.getByText('Đến lượt bạn', { exact: true })
    if (!(await mine.isVisible())) {
      await page.waitForTimeout(400)
      continue
    }
    if (await page.getByRole('region', { name: 'Bài trên bàn' }).getByText(/Vòng mới/).isVisible()) {
      const card = page.locator('[aria-label="Bài của bạn"] [data-card]').first()
      if ((await card.isVisible()) && (await card.isEnabled()) && (await card.getAttribute('aria-pressed')) !== 'true') {
        await card.click().catch(() => {})
        await page.waitForTimeout(100)
      }
      const playBtn = page.getByRole('button', { name: 'Đánh' })
      if ((await playBtn.isVisible()) && (await playBtn.isEnabled())) {
        await playBtn.click().catch(() => {})
      }
    } else {
      const passBtn = page.getByRole('button', { name: 'Bỏ lượt' })
      if ((await passBtn.isVisible()) && (await passBtn.isEnabled())) {
        await passBtn.click().catch(() => {})
      }
    }
    await page.waitForTimeout(500)
  }
}

try {
  // Login page (signed out).
  {
    const context = await browser.newContext({ viewport: SIZES.desktop, locale: 'vi-VN' })
    const page = await context.newPage()
    await page.goto(`${APP}/login`)
    await page.getByRole('button', { name: 'Đăng nhập' }).waitFor()
    await shot(page, '01-login')
    await page.goto(`${APP}/register`)
    await shot(page, '02-register')
    await context.close()
  }

  // 4 seats: lobby, waiting room, table with a selection, result, history, profile, admin.
  {
    const { page, userId } = await newUser('four')
    await shot(page, '03-lobby')
    await page.getByRole('button', { name: 'Tạo phòng' }).click()
    await page.getByText('Phòng chờ').waitFor()
    await shot(page, '04-waiting-alone')
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Thêm máy' }).click()
      await page.waitForFunction((n) => [...document.querySelectorAll('[aria-label="Chỗ ngồi"] li')].filter((li) => li.textContent.includes('🤖')).length >= n, i + 1)
    }
    await shot(page, '05-waiting-full')
    await startAndWaitMyTurn(page, 4)
    await page.locator('[aria-label="Bài của bạn"] [data-card]').nth(1).click()
    await shot(page, '06-table-4-players')
    await page.locator('[aria-label="Bài của bạn"] [data-card]').nth(1).click()
    await playOut(page)
    await page.waitForTimeout(800)
    await shot(page, '07-result-practice')
    await page.getByRole('link', { name: 'Lịch sử' }).first().click().catch(() => page.goto(`${APP}/history`))
    await page.goto(`${APP}/history`)
    await page.waitForTimeout(800)
    await shot(page, '08-history-empty')
    await page.goto(`${APP}/profile`)
    await page.getByText('Tổng điểm').waitFor()
    await shot(page, '09-profile')
    await admin.from('profiles').update({ is_admin: true }).eq('id', userId)
    await page.goto(`${APP}/admin`)
    await page.waitForTimeout(1500)
    await shot(page, '10-admin')
  }

  // 3 and 2 seats.
  {
    const { page } = await tableWith('three', 2)
    await startAndWaitMyTurn(page, 3)
    await shot(page, '11-table-3-players')
  }
  {
    const { page } = await tableWith('two', 1)
    await startAndWaitMyTurn(page, 2)
    await shot(page, '12-table-2-players')
  }

  // A ranked 2-player result with a capped loss, via the real functions (two humans).
  {
    const a = await newUser('rankA')
    const b = await newUser('rankB')
    await a.page.getByRole('button', { name: 'Tạo phòng' }).click()
    await a.page.getByText('Phòng chờ').waitFor()
    const code = (await a.page.getByLabel(/^Mã phòng /).textContent()).trim()
    await b.page.getByLabel('Mã phòng').fill(code)
    await b.page.getByRole('button', { name: 'Vào phòng' }).click()
    await a.page.getByRole('button', { name: 'Bắt đầu ván (2 người)' }).waitFor()
    await a.page.waitForTimeout(500)
    await shot(a.page, '13-waiting-ranked')
    await a.page.getByRole('button', { name: 'Bắt đầu ván (2 người)' }).click()
    await a.page.waitForURL(/\/match\//)
    await b.page.waitForURL(/\/match\//)
    // Whoever leads plays everything; the other always passes.
    for (let i = 0; i < 40; i++) {
      const done = await a.page.getByRole('region', { name: 'Kết quả' }).isVisible()
      if (done) break
      for (const p of [a.page, b.page]) {
        if (!(await p.getByText('Đến lượt bạn', { exact: true }).isVisible())) continue
        if (await p.getByRole('region', { name: 'Bài trên bàn' }).getByText(/Vòng mới/).isVisible()) {
          const card = p.locator('[aria-label="Bài của bạn"] [data-card]').first()
          if ((await card.isVisible()) && (await card.isEnabled()) && (await card.getAttribute('aria-pressed')) !== 'true') {
            await card.click().catch(() => {})
            await p.waitForTimeout(100)
          }
          const playBtn = p.getByRole('button', { name: 'Đánh' })
          if ((await playBtn.isVisible()) && (await playBtn.isEnabled())) {
            await playBtn.click().catch(() => {})
          }
        } else {
          const passBtn = p.getByRole('button', { name: 'Bỏ lượt' })
          if ((await passBtn.isVisible()) && (await passBtn.isEnabled())) {
            await passBtn.click().catch(() => {})
          }
        }
        await p.waitForTimeout(400)
      }
      await a.page.waitForTimeout(300)
    }
    await a.page.getByRole('region', { name: 'Kết quả' }).waitFor({ timeout: 30_000 })
    await a.page.waitForTimeout(800)
    await shot(a.page, '14-result-ranked')
  }
} finally {
  await browser.close()
}
console.log(shots.join('\n'))
