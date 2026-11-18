import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * R36: one person creates a room, adds two bots and plays a practice match to the end through the UI.
 * The server plays the bots' turns. Practice matches change no points and write no history.
 */
test('1 player + 2 bots: add bots → start → play to the end → practice result, points unchanged', async ({ page }) => {
  const run = randomUUID().replace(/-/g, '').slice(0, 8)
  const password = `e2e-${randomUUID()}`
  await page.goto('/register')
  await page.getByLabel('Tên đăng nhập', { exact: true }).fill(`bot_e2e_${run}`)
  await page.getByLabel('Tên hiển thị', { exact: true }).fill(`Solo ${run.slice(0, 4)}`)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password)
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Đăng ký' }).click()
  await expect(page.getByLabel('Tài khoản')).toContainText('10 điểm') // R34: new accounts start with 10

  await page.getByRole('button', { name: 'Tạo phòng' }).click()
  await expect(page.getByRole('button', { name: 'Cần ít nhất 2 người' })).toBeDisabled()
  await page.getByRole('button', { name: 'Thêm máy' }).click()
  await expect(page.getByRole('list', { name: 'Chỗ ngồi' })).toContainText('🤖')
  await page.getByRole('button', { name: 'Thêm máy' }).click()
  await expect(page.getByRole('button', { name: 'Bắt đầu ván (3 người)' })).toBeEnabled()
  await expect(page.getByText(/ván luyện tập/)).toBeVisible()
  await page.getByRole('button', { name: 'Bắt đầu ván (3 người)' }).click()

  await expect(page).toHaveURL(/\/match\//)
  await expect(page.getByRole('list', { name: 'Đối thủ' }).getByLabel('Máy')).toHaveCount(2)

  // Play: lead the lowest card, otherwise pass. Bots move on the server between our turns.
  const result = page.getByRole('region', { name: 'Kết quả' })
  for (let step = 0; step < 80; step++) {
    if (await result.isVisible()) break
    const myTurn = page.getByText('Đến lượt bạn', { exact: true })
    try {
      await myTurn.waitFor({ timeout: 20_000 })
    } catch {
      continue // the match may have ended on a bot's move
    }
    if (await page.getByRole('region', { name: 'Bài trên bàn' }).getByText(/Vòng mới/).isVisible()) {
      await page.locator('[aria-label="Bài của bạn"] [data-card]').first().click()
      await page.getByRole('button', { name: 'Đánh' }).click()
    } else {
      await page.getByRole('button', { name: 'Bỏ lượt' }).click()
    }
    await expect(myTurn).toBeHidden({ timeout: 15_000 }).catch(() => {})
  }

  await expect(result).toBeVisible({ timeout: 30_000 })
  await expect(result).toContainText('Ván luyện tập có máy: không cộng/trừ điểm')
  await expect(result.getByRole('table')).toHaveCount(0)
  await expect(page.getByLabel('Tài khoản')).toContainText('10 điểm')

  await page.getByRole('link', { name: 'Lịch sử' }).click()
  await expect(page.getByText('Bạn chưa chơi ván nào.')).toBeVisible()
})
