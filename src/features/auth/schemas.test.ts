import { LoginSchema, RegisterSchema, fieldErrors, toInternalEmail, toInternalUsername } from './schemas'

const validRegistration = {
  username: 'an_nguyen',
  displayName: 'An Nguyễn',
  password: 'secret123',
  confirmPassword: 'secret123',
}

describe('RegisterSchema', () => {
  it('accepts a valid registration without email', () => {
    expect(RegisterSchema.safeParse(validRegistration).success).toBe(true)
  })

  it.each(['ab', 'Quang Nguyễn', 'has space', 'dấu', 'dash-name', '1'])(
    'accepts arbitrary username %j and maps it to a valid internal identifier',
    (username) => {
      const result = RegisterSchema.safeParse({ ...validRegistration, username })
      expect(result.success).toBe(true)
      const internal = toInternalUsername(username)
      expect(internal).toMatch(/^[a-z0-9_]{3,20}$/)
      expect(toInternalEmail(username)).toBe(`${internal}@xam.local`)
    },
  )

  it('defaults displayName to username when left blank', () => {
    const parsed = RegisterSchema.parse({ ...validRegistration, username: 'Minh Hoàng', displayName: '' })
    expect(parsed.displayName).toBe('Minh Hoàng')
  })

  it('rejects an empty username', () => {
    const result = RegisterSchema.safeParse({ ...validRegistration, username: '   ' })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrors(result.error).username).toBeDefined()
  })

  it('rejects a short password', () => {
    const result = RegisterSchema.safeParse({ ...validRegistration, password: '123', confirmPassword: '123' })
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
  it('requires a username and a password', () => {
    const result = LoginSchema.safeParse({ username: '  ', password: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = fieldErrors(result.error)
      expect(errors.username).toBeDefined()
      expect(errors.password).toBeDefined()
    }
  })
})
