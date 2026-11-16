import { LoginSchema, RegisterSchema, fieldErrors } from './schemas'

const validRegistration = {
  email: 'an@example.com',
  username: 'an_nguyen',
  displayName: 'An Nguyễn',
  password: 'secret123',
  confirmPassword: 'secret123',
}

describe('RegisterSchema', () => {
  it('accepts a valid registration', () => {
    expect(RegisterSchema.safeParse(validRegistration).success).toBe(true)
  })

  it('normalises the username to trimmed lower case (matches the DB trigger)', () => {
    const parsed = RegisterSchema.parse({ ...validRegistration, username: '  An_Nguyen ' })
    expect(parsed.username).toBe('an_nguyen')
  })

  it.each(['ab', 'a'.repeat(21), 'has space', 'dấu', 'dash-name'])('rejects username %j', (username) => {
    const result = RegisterSchema.safeParse({ ...validRegistration, username })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error).username).toBeDefined()
  })

  it('rejects a short password', () => {
    const result = RegisterSchema.safeParse({ ...validRegistration, password: 'short', confirmPassword: 'short' })
    expect(result.success).toBe(false)
  })

  it('rejects mismatched passwords on the confirm field', () => {
    const result = RegisterSchema.safeParse({ ...validRegistration, confirmPassword: 'different1' })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error).confirmPassword).toBe('Mật khẩu xác nhận không khớp')
  })

  it('rejects a display name longer than 32 characters', () => {
    const result = RegisterSchema.safeParse({ ...validRegistration, displayName: 'x'.repeat(33) })
    expect(result.success).toBe(false)
  })
})

describe('LoginSchema', () => {
  it('requires a valid email and a password', () => {
    const result = LoginSchema.safeParse({ email: 'nope', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = fieldErrors(result.error)
      expect(errors.email).toBeDefined()
      expect(errors.password).toBeDefined()
    }
  })
})
