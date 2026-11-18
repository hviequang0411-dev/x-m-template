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
    setDone(true)
  }

  if (done) {
    return (
      <Card className="border-gold/40 shadow-2xl">
        <CardHeader>
          <CardTitle className="text-2xl">Đăng ký thành công</CardTitle>
          <CardDescription>Tài khoản của bạn đã sẵn sàng để vào bàn chơi.</CardDescription>
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
    <Card className="border-gold/40 shadow-2xl">
      <CardHeader className="border-b border-card-border/60 pb-4">
        <CardTitle className="text-2xl">Tạo tài khoản</CardTitle>
        <CardDescription>Chọn tên bất kỳ để vào bàn chơi nhanh</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4 pt-5">
          <FormField id="username" label="Tên đăng nhập" autoComplete="username" error={errors.username} />
          <FormField
            id="displayName"
            label="Tên hiển thị"
            placeholder="Để trống sẽ dùng tên đăng nhập"
            autoComplete="nickname"
            error={errors.displayName}
          />
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
            <p role="alert" className="rounded-lg border border-suit-red/30 bg-red-50 px-3 py-2 text-sm text-suit-red">
              {errors.form}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Đang tạo…' : 'Đăng ký'}
          </Button>
          <p className="text-sm text-slate-600">
            Đã có tài khoản?{' '}
            <Link to="/login" className="font-semibold text-felt underline">
              Đăng nhập
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
