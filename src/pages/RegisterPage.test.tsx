import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RegisterPage } from './RegisterPage'

const signUp = vi.fn()
vi.mock('@/features/auth/api', () => ({ signUp: (...args: unknown[]) => signUp(...args) }))

function setup() {
  render(
    <MemoryRouter>
      <RegisterPage />
    </MemoryRouter>,
  )
  return userEvent.setup()
}

async function fill(user: ReturnType<typeof userEvent.setup>, overrides: Record<string, string> = {}) {
  const values = {
    Email: 'an@example.com',
    'Tên đăng nhập': 'an_nguyen',
    'Tên hiển thị': 'An',
    'Mật khẩu': 'secret123',
    'Xác nhận mật khẩu': 'secret123',
    ...overrides,
  }
  for (const [label, value] of Object.entries(values)) {
    if (value) await user.type(screen.getByLabelText(label, { exact: true }), value)
  }
}

describe('RegisterPage', () => {
  beforeEach(() => signUp.mockReset())

  it('shows validation errors and does not call the API for invalid input', async () => {
    const user = setup()
    await fill(user, { 'Tên đăng nhập': 'x', 'Xác nhận mật khẩu': 'other1234' })
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))
    expect(screen.getByText(/Tên đăng nhập 3–20 ký tự/)).toBeInTheDocument()
    expect(screen.getByText('Mật khẩu xác nhận không khớp')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('submits normalised data and shows server errors', async () => {
    signUp.mockResolvedValue({ ok: false, message: 'Email này đã được đăng ký' })
    const user = setup()
    await fill(user, { 'Tên đăng nhập': 'An_Nguyen' })
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ username: 'an_nguyen', email: 'an@example.com' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email này đã được đăng ký')
  })

  it('shows the success state when sign-up succeeds', async () => {
    signUp.mockResolvedValue({ ok: true })
    const user = setup()
    await fill(user)
    await user.click(screen.getByRole('button', { name: 'Đăng ký' }))
    expect(await screen.findByText('Đăng ký thành công')).toBeInTheDocument()
  })
})
