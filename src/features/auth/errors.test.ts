import { authErrorMessage } from './errors'

describe('authErrorMessage', () => {
  it('maps invalid credentials', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'Email hoặc mật khẩu không đúng',
    )
  })

  it('maps the profile-trigger failure to a username message', () => {
    expect(authErrorMessage({ code: 'unexpected_failure', message: 'Database error saving new user' })).toBe(
      'Tên đăng nhập đã tồn tại hoặc không hợp lệ',
    )
  })

  it('never echoes raw server text for unknown errors', () => {
    const msg = authErrorMessage({ code: 'weird', message: 'relation "secret_table" does not exist at line 3' })
    expect(msg).not.toContain('secret_table')
    expect(msg).toBe('Đã xảy ra lỗi. Vui lòng thử lại.')
  })

  it('handles null', () => {
    expect(authErrorMessage(null)).toBe('Đã xảy ra lỗi. Vui lòng thử lại.')
  })
})
