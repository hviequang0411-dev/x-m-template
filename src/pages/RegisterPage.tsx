import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/FormField'
import { RegisterSchema, fieldErrors } from '@/features/auth/schemas'
import { signUp } from '@/features/auth/api'

export function RegisterPage() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = RegisterSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setSubmitting(true)
    const result = await signUp(parsed.data)
    setSubmitting(false)
    if (!result.ok) return setErrors({ form: result.message })
    // Without email confirmation a session exists and RequireGuest redirects to the lobby.
    // With confirmation enabled (production), the user lands on this message instead.
    setDone(true)
  }

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Đăng ký thành công</CardTitle>
          <CardDescription>Nếu được yêu cầu, hãy kiểm tra email để xác nhận tài khoản.</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link to="/login">Đến trang đăng nhập</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tạo tài khoản</CardTitle>
        <CardDescription>Chỉ dành cho người chơi thử nghiệm</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          <FormField id="email" label="Email" type="email" autoComplete="email" error={errors.email} />
          <FormField id="username" label="Tên đăng nhập" autoComplete="username" error={errors.username} />
          <FormField id="displayName" label="Tên hiển thị" autoComplete="nickname" error={errors.displayName} />
          <FormField
            id="password"
            label="Mật khẩu"
            type="password"
            autoComplete="new-password"
            error={errors.password}
          />
          <FormField
            id="confirmPassword"
            label="Xác nhận mật khẩu"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword}
          />
          {errors.form && (
            <p role="alert" className="text-sm text-red-600">
              {errors.form}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Đang tạo…' : 'Đăng ký'}
          </Button>
          <p className="text-sm text-slate-500">
            Đã có tài khoản?{' '}
            <Link to="/login" className="font-medium text-felt underline">
              Đăng nhập
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
