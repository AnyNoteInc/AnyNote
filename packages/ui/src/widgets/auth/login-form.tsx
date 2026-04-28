'use client'

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
  forgotPasswordHref?: string
  signUpHref?: string
  isSubmitting?: boolean
}

export function LoginForm({
  defaultValues,
  onSubmit,
  onGoogle,
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

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit?.(values)
  })

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <AuthHeader title="Вход в учётную запись" />
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
      <Divider />
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
        <Stack direction="row" alignItems="center" justifyContent="space-between">
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
      <Typography variant="body2" textAlign="center" color="text.secondary">
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
