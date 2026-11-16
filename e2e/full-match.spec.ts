import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * T7.1: four players in four isolated browser contexts register, meet in a room, play a full match
 * through the UI and all see the persisted result. Runs against the local stack only.
 *
 * Strategy: whoever leads plays their lowest card; everyone else passes. The leader keeps the lead
 * and empties their hand in 10 rounds, so the other three never play and each pays cóng (15).
 */

interface Player {
  page: Page
  name: string
}

const PASSWORD = `e2e-${randomUUID()}`
const RUN = randomUUID().replace(/-/g, '').slice(0, 8)

async function register(browser: Browser, i: number): Promise<Player> {
  const context = await browser.newContext()
  const page = await context.newPage()
  const name = `E2E ${i} ${RUN.slice(0, 4)}`
  await page.goto('/register')
  await page.getByLabel('Email', { exact: true }).fill(`e2e_${RUN}_${i}@xam.test`)
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(`e2e_${RUN}_${i}`)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(name)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await expect(page.getByText(`Xin chào, ${name}`)).toBeVisible()
  return { page, name }
}

const myTurn = (p: Player) => p.page.getByText('Đến lượt bạn', { exact: true })

test('4 players: register → room → start → play to the end → result', async ({ browser }) => {
  const players = await Promise.all([0, 1, 2, 3].map((i) => register(browser, i)))
  const [host, ...guests] = players

  // Host creates a room; the code is shown in the waiting room.
  await host!.page.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(host!.page.getByText('Phòng chờ')).toBeVisible()
  const code = (await host!.page.getByLabel(/^Mã phòng /).textContent())!.trim()
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/)

  // Guests join by code (typed in lower case; the form upper-cases it).
  for (const g of guests) {
    await g.page.getByLabel('Mã phòng').fill(code.toLowerCase())
    await g.page.getByRole('button', { name: 'Vào phòng' }).click()
    await expect(g.page.getByText('Đang chờ chủ phòng bắt đầu…').or(g.page.getByText(/Đang chờ thêm người/))).toBeVisible()
  }

  // The host's seat list fills in live, then the host starts. Everyone lands on the table.
  for (const g of guests) await expect(host!.page.getByRole('list', { name: 'Chỗ ngồi' })).toContainText(g.name)
  await host!.page.getByRole('button', { name: 'Bắt đầu ván' }).click()
  for (const p of players) {
    await expect(p.page).toHaveURL(/\/match\//)
    await expect(p.page.locator('[aria-label="Bài của bạn"] [data-card]')).toHaveCount(10)
  }

  // Each player sees only their own 10 cards; together they are 40 different cards.
  const hands = await Promise.all(
    players.map((p) => p.page.locator('[aria-label="Bài của bạn"] [data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')))),
  )
  expect(new Set(hands.flat()).size).toBe(40)

  // A non-leader can't play out of turn: their buttons are disabled.
  // Play: leader → lowest card, others → pass, until the match ends.
  let winner: Player | null = null
  for (let step = 0; step < 60 && !winner; step++) {
    let actor: Player | null = null
    await expect(async () => {
      for (const p of players) if (await myTurn(p).isVisible()) actor = p
      expect(actor).not.toBeNull()
    }).toPass({ timeout: 15_000 })
    const p = actor! as Player

    const table = p.page.getByRole('region', { name: 'Bài trên bàn' })
    if (await table.getByText(/Vòng mới/).isVisible()) {
      await expect(p.page.getByRole('button', { name: 'Bỏ lượt' })).toBeDisabled() // the leader can't pass (R16)
      const before = await p.page.locator('[aria-label="Bài của bạn"] [data-card]').count()
      await p.page.locator('[aria-label="Bài của bạn"] [data-card]').first().click()
      await p.page.getByRole('button', { name: 'Đánh' }).click()
      if (before === 1) winner = p
    } else {
      await p.page.getByRole('button', { name: 'Bỏ lượt' }).click()
    }
    if (!winner) await expect(myTurn(p)).toBeHidden()
  }
  expect(winner).not.toBeNull()

  // Every player sees the same persisted result: winner +45, the others cóng −15.
  for (const p of players) {
    const result = p.page.getByRole('region', { name: 'Kết quả' })
    await expect(result.getByRole('status')).toHaveText(p === winner ? 'Bạn thắng ván này! 🏆' : `${winner!.name} thắng ván này`)
    const rows = result.getByRole('table', { name: 'Kết quả ván' }).locator('tbody tr')
    await expect(rows).toHaveCount(4)
    await expect(rows.first()).toContainText(winner!.name)
    await expect(rows.first()).toContainText('+45')
    for (let r = 1; r < 4; r++) {
      await expect(rows.nth(r)).toContainText('Cóng')
      await expect(rows.nth(r)).toContainText('-15')
    }
  }

  // History and profile show the same numbers.
  const loser = players.find((p) => p !== winner)!
  await loser.page.getByRole('link', { name: 'Lịch sử' }).click()
  await expect(loser.page.getByRole('list', { name: 'Các ván đã chơi' }).getByRole('link')).toHaveCount(1)
  await expect(loser.page.getByRole('list', { name: 'Các ván đã chơi' })).toContainText('-15')
  await winner!.page.getByRole('link', { name: 'Hồ sơ' }).click()
  await expect(winner!.page.getByText('Tổng điểm').locator('..')).toContainText('45')

  // Back to the room: same 4 seats, the winner's seat leads next time (R14, R31).
  await players[1]!.page.goto('/')
  await players[1]!.page.getByRole('link', { name: 'Vào phòng' }).click()
  await expect(players[1]!.page.getByRole('list', { name: 'Chỗ ngồi' }).getByRole('listitem')).toHaveCount(4)
  await expect(players[1]!.page.getByText('Trống')).toHaveCount(0)
})
