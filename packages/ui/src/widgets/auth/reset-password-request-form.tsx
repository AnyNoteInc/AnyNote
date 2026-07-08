'use client'

import { useForm } from 'react-hook-form'
import {
  Alert,
  Button,
  Divider,
  KeyboardDoubleArrowLeftIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { AuthHeader } from './auth-header'

export type ResetPasswordRequestFormValues = {
  email: string
}

export type ResetPasswordRequestFormProps = {
  defaultValues?: Partial<ResetPasswordRequestFormValues>
  onSubmit?: (values: ResetPasswordRequestFormValues) => Promise<void>
  signInHref?: string
  isSubmitting?: boolean
  successMessage?: string | null
}

export function ResetPasswordRequestForm({
  defaultValues,
  onSubmit,
  signInHref = '/sign-in',
  isSubmitting,
  successMessage,
}: ResetPasswordRequestFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<ResetPasswordRequestFormValues>({
    defaultValues: { email: '', ...defaultValues },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit?.(values)
  })

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <AuthHeader title="Забыли пароль" />
      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}
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
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <KeyboardDoubleArrowLeftIcon fontSize="small" />
        <Typography
          component="a"
          href={signInHref}
          variant="body2"
          sx={{ textDecoration: 'none', color: 'inherit' }}
        >
          Назад ко входу
        </Typography>
      </Stack>
      <Button type="submit" variant="contained" size="large" disabled={submitting} fullWidth>
        Подтвердить
      </Button>
      <Divider />
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        Введите ваш e-mail и мы вышлем инструкции по получению нового пароля.
      </Typography>
    </Stack>
  )
}
