import { z } from 'zod'

/** Must match the CHECK constraints on public.profiles (migration 0001). */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/

export const LoginSchema = z.object({
  email: z.email('Email không hợp lệ'),
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
})
export type LoginInput = z.infer<typeof LoginSchema>

export const RegisterSchema = z
  .object({
    email: z.email('Email không hợp lệ'),
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(USERNAME_PATTERN, 'Tên đăng nhập 3–20 ký tự: chữ thường, số, dấu gạch dưới'),
    displayName: z
      .string()
      .trim()
      .min(1, 'Vui lòng nhập tên hiển thị')
      .max(32, 'Tên hiển thị tối đa 32 ký tự'),
    password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(72, 'Mật khẩu tối đa 72 ký tự'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu xác nhận không khớp',
  })
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
