'use client'

import { useForm } from 'react-hook-form'
import { Alert, Button, Stack, TextField } from '@repo/ui/components'

import { AuthHeader } from './auth-header'

export type ResetPasswordConfirmFormValues = {
  password: string
  confirmPassword: string
}

export type ResetPasswordConfirmFormProps = {
  onSubmit?: (newPassword: string) => Promise<void>
  isSubmitting?: boolean
  errorMessage?: string | null
}

export function ResetPasswordConfirmForm({
  onSubmit,
  isSubmitting,
  errorMessage,
}: ResetPasswordConfirmFormProps) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<ResetPasswordConfirmFormValues>({
    defaultValues: { password: '', confirmPassword: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(async ({ password, confirmPassword }) => {
    if (password !== confirmPassword) {
      setError('confirmPassword', { type: 'validate', message: 'Пароли не совпадают' })
      return
    }
    await onSubmit?.(password)
  })

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <AuthHeader title="Новый пароль" />
      {errorMessage ? <Alert severity="error">{errorMessage}</Alert> : null}
      <TextField
        {...register('password', {
          required: 'Введите пароль',
          minLength: { value: 8, message: 'Минимум 8 символов' },
        })}
        label="Пароль"
        type="password"
        fullWidth
        autoComplete="new-password"
        error={!!errors.password}
        helperText={errors.password?.message}
      />
      <TextField
        {...register('confirmPassword', { required: 'Повторите пароль' })}
        label="Повторите пароль"
        type="password"
        fullWidth
        autoComplete="new-password"
        error={!!errors.confirmPassword}
        helperText={errors.confirmPassword?.message}
      />
      <Button type="submit" variant="contained" size="large" disabled={submitting} fullWidth>
        Сохранить
      </Button>
    </Stack>
  )
}
