'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { AuthHeader } from './auth-header'

export type LoginFormValues = {
  email: string
  password: string
  rememberMe: boolean
}

export type LoginFormProps = {
  defaultValues?: Partial<LoginFormValues>
  onSubmit?: (values: LoginFormValues) => void | Promise<void>
  onGoogle?: () => void | Promise<void>
  /**
   * SSO slot (the `onGoogle` pattern): when provided, a «Войти через SSO»
   * toggle renders under the Google button and expands a corporate-email
   * field. The widget stays presentational — resolving the provider and
   * starting the flow is the caller's job; the caller surfaces failures via
   * `ssoError`.
   */
  onSso?: (email: string) => void | Promise<void>
  ssoError?: string | null
  forgotPasswordHref?: string
  signUpHref?: string
  isSubmitting?: boolean
}

const EMAIL_PATTERN = /\S+@\S+\.\S+/

export function LoginForm({
  defaultValues,
  onSubmit,
  onGoogle,
  onSso,
  ssoError,
  forgotPasswordHref = '/reset-credentials',
  signUpHref = '/sign-up',
  isSubmitting,
}: LoginFormProps) {
  const formDefaults: LoginFormValues = {
    email: '',
    password: '',
    rememberMe: false,
    ...defaultValues,
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<LoginFormValues>({
    defaultValues: formDefaults,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })

  const [ssoOpen, setSsoOpen] = useState(false)
  const [ssoEmail, setSsoEmail] = useState('')
  const [ssoEmailError, setSsoEmailError] = useState<string | null>(null)
  const [ssoSubmitting, setSsoSubmitting] = useState(false)

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit?.(values)
  })

  const handleSsoContinue = async (): Promise<void> => {
    if (!EMAIL_PATTERN.test(ssoEmail)) {
      setSsoEmailError('Введите корректный email')
      return
    }
    setSsoEmailError(null)
    setSsoSubmitting(true)
    try {
      await onSso?.(ssoEmail)
    } finally {
      setSsoSubmitting(false)
    }
  }

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <AuthHeader title="Вход в учётную запись" />
      {onGoogle ? (
        <>
          <Divider />
          <Button
            variant="outlined"
            size="large"
            onClick={() => onGoogle?.()}
            disabled={submitting}
            fullWidth
          >
            Войти через Google
          </Button>
        </>
      ) : null}
      {onSso ? (
        <>
          {onGoogle ? null : <Divider />}
          <Button
            variant="text"
            size="large"
            onClick={() => setSsoOpen((open) => !open)}
            disabled={submitting}
            fullWidth
            data-testid="sso-signin-toggle"
          >
            Войти через SSO
          </Button>
          {ssoOpen ? (
            <Stack spacing={1.5}>
              <TextField
                value={ssoEmail}
                onChange={(event) => {
                  setSsoEmail(event.target.value)
                  setSsoEmailError(null)
                }}
                onKeyDown={(event) => {
                  // The field lives inside the password form — Enter must
                  // start the SSO flow, not submit email/password.
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleSsoContinue()
                  }
                }}
                label="Рабочий email"
                type="email"
                fullWidth
                autoComplete="email"
                error={Boolean(ssoEmailError ?? ssoError)}
                helperText={ssoEmailError ?? ssoError}
                slotProps={{ htmlInput: { 'data-testid': 'sso-email-input' } }}
              />
              <Button
                type="button"
                variant="outlined"
                size="large"
                onClick={() => void handleSsoContinue()}
                disabled={submitting || ssoSubmitting}
                fullWidth
              >
                Продолжить
              </Button>
            </Stack>
          ) : null}
        </>
      ) : null}
      {onGoogle || onSso ? <Divider /> : null}
      <Stack spacing={2.5}>
        <TextField
          {...register('email', {
            required: 'Введите email',
            pattern: { value: /\S+@\S+\.\S+/, message: 'Введите корректный email' },
          })}
          label="Email"
          fullWidth
          autoComplete="email"
          error={!!errors.email}
          helperText={errors.email?.message}
        />
        <TextField
          {...register('password', { required: 'Введите пароль' })}
          label="Пароль"
          type="password"
          fullWidth
          autoComplete="current-password"
          error={!!errors.password}
          helperText={errors.password?.message}
        />
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <FormControlLabel
            control={<Checkbox {...register('rememberMe')} size="small" />}
            label="Запомнить меня"
          />
          <Typography
            component="a"
            href={forgotPasswordHref}
            variant="body2"
            sx={{ textDecoration: 'none', color: 'inherit' }}
          >
            Забыли пароль?
          </Typography>
        </Stack>
        <Button type="submit" variant="contained" size="large" disabled={submitting} fullWidth>
          Войти
        </Button>
      </Stack>
      <Divider />
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        Новый пользователь?{' '}
        <Typography
          component="a"
          href={signUpHref}
          variant="body2"
          sx={{ color: 'inherit', fontWeight: 600 }}
        >
          Регистрация
        </Typography>
      </Typography>
    </Stack>
  )
}
