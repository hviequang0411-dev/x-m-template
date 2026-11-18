import { z } from 'zod'

const SIMPLE_USERNAME_RE = /^[a-z0-9_]{3,20}$/

function fnv1aBase36(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Converts any user-chosen username into a deterministic 3–20 char `[a-z0-9_]`
 * identifier that satisfies the database `profiles_username_format` constraint.
 */
export function toInternalUsername(raw: string): string {
  const lower = raw.trim().toLowerCase()
  if (SIMPLE_USERNAME_RE.test(lower) && !lower.startsWith('u_')) {
    return lower
  }
  const ascii = lower
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 9)
  const hash = fnv1aBase36(lower).padStart(3, '0')
  return ascii ? `u_${ascii}_${hash}`.slice(0, 20) : `u_${hash}`.slice(0, 20)
}

export function toInternalEmail(raw: string): string {
  return `${toInternalUsername(raw)}@xam.local`
}

export const LoginSchema = z.object({
  username: z.string().trim().min(1, 'Vui lòng nhập tên đăng nhập'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})
export type LoginInput = z.infer<typeof LoginSchema>

export const RegisterSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1, 'Vui lòng nhập tên đăng nhập')
      .max(32, 'Tên đăng nhập tối đa 32 ký tự'),
    displayName: z
      .string()
      .trim()
      .max(32, 'Tên hiển thị tối đa 32 ký tự')
      .optional()
      .default(''),
    password: z.string().min(6, 'Mật khẩu tối thiểu 6 ký tự').max(72, 'Mật khẩu tối đa 72 ký tự'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu xác nhận không khớp',
  })
  .transform((v) => ({
    ...v,
    displayName: v.displayName || v.username,
  }))
export type RegisterInput = z.infer<typeof RegisterSchema>

/** Flattens Zod issues into { field: firstMessage } for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    out[key] ??= issue.message
  }
  return out
}
