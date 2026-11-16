import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { FormField } from '@/components/FormField'
import { LoginSchema, fieldErrors } from '@/features/auth/schemas'
import { signIn } from '@/features/auth/api'

export function LoginPage() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const parsed = LoginSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)))
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    setErrors({})
    setSubmitting(true)
    const result = await signIn(parsed.data)
    setSubmitting(false)
    // On success the auth listener updates the store and RequireGuest redirects.
    if (!result.ok) setErrors({ form: result.message })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Đăng nhập</CardTitle>
        <CardDescription>Vào bàn chơi cùng bạn bè</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="grid gap-4">
          <FormField id="email" label="Email" type="email" autoComplete="email" error={errors.email} />
          <FormField
            id="password"
            label="Mật khẩu"
            type="password"
            autoComplete="current-password"
            error={errors.password}
          />
          {errors.form && (
            <p role="alert" className="text-sm text-red-600">
              {errors.form}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </Button>
          <p className="text-sm text-slate-500">
            Chưa có tài khoản?{' '}
            <Link to="/register" className="font-medium text-felt underline">
              Đăng ký
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
