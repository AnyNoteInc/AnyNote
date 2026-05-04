'use client'

import { useForm } from 'react-hook-form'
import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  KeyboardDoubleArrowLeftIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { AuthHeader } from './auth-header'

export type RegisterFormValues = {
  email: string
  firstName: string
  lastName: string
  password: string
  confirmPassword: string
  agreedToTerms: boolean
}

export type RegisterSubmitPayload = Omit<RegisterFormValues, 'confirmPassword' | 'agreedToTerms'>

export type TermsUrls = {
  userAgreement: string
  privacyPolicy: string
  publicOffer: string
}

export type RegisterFormProps = {
  defaultValues?: Partial<RegisterFormValues>
  onSubmit?: (values: RegisterSubmitPayload) => Promise<void>
  signInHref?: string
  isSubmitting?: boolean
  termsUrls?: TermsUrls
}

export function RegisterForm({
  defaultValues,
  onSubmit,
  signInHref = '/sign-in',
  isSubmitting,
  termsUrls,
}: RegisterFormProps) {
  const formDefaults: RegisterFormValues = {
    email: '',
    lastName: '',
    firstName: '',
    password: '',
    confirmPassword: '',
    agreedToTerms: false,
    ...defaultValues,
  }

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<RegisterFormValues>({
    defaultValues: formDefaults,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  })

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(async (formValues) => {
    if (formValues.password !== formValues.confirmPassword) {
      setError('confirmPassword', {
        type: 'validate',
        message: 'Пароли не совпадают',
      })
      return
    }
    const { email, firstName, lastName, password } = formValues
    await onSubmit?.({ email, firstName, lastName, password })
  })

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <AuthHeader title="Регистрация" />
      <Stack spacing={2.5}>
        <TextField
          {...register('email', {
            required: 'Введите email',
            pattern: {
              value: /\S+@\S+\.\S+/,
              message: 'Введите корректный email',
            },
          })}
          type="email"
          label="Email"
          fullWidth
          autoComplete="email"
          error={!!errors.email}
          helperText={errors.email?.message}
        />
        <TextField
          {...register('lastName', { required: 'Введите фамилию' })}
          label="Фамилия"
          fullWidth
          autoComplete="family-name"
          error={!!errors.lastName}
          helperText={errors.lastName?.message}
        />
        <TextField
          {...register('firstName', { required: 'Введите имя' })}
          label="Имя"
          fullWidth
          autoComplete="given-name"
          error={!!errors.firstName}
          helperText={errors.firstName?.message}
        />
        <Divider />
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
          {...register('confirmPassword', {
            required: 'Повторите пароль',
          })}
          label="Повторите пароль"
          type="password"
          fullWidth
          autoComplete="new-password"
          error={!!errors.confirmPassword}
          helperText={errors.confirmPassword?.message}
        />
        <Stack direction="row" alignItems="center" spacing={0.5}>
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
        {termsUrls ? (
          <Box>
            <FormControlLabel
              control={
                <Checkbox
                  {...register('agreedToTerms', {
                    required: 'Необходимо принять условия',
                  })}
                  size="small"
                  data-testid="register-terms-checkbox"
                />
              }
              sx={{ alignItems: 'flex-start', m: 0 }}
              label={
                <Typography variant="body2" color="text.secondary" sx={{ pt: 0.75 }}>
                  Я принимаю{' '}
                  <Box
                    component="a"
                    href={termsUrls.userAgreement}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: 'primary.main' }}
                  >
                    пользовательское соглашение
                  </Box>
                  ,{' '}
                  <Box
                    component="a"
                    href={termsUrls.privacyPolicy}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: 'primary.main' }}
                  >
                    политику обработки персональных данных
                  </Box>{' '}
                  и{' '}
                  <Box
                    component="a"
                    href={termsUrls.publicOffer}
                    target="_blank"
                    rel="noopener noreferrer"
                    sx={{ color: 'primary.main' }}
                  >
                    оферту на оказание услуг
                  </Box>
                </Typography>
              }
            />
            {errors.agreedToTerms ? (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, ml: 4 }}>
                {errors.agreedToTerms.message}
              </Typography>
            ) : null}
          </Box>
        ) : null}
        <Button type="submit" variant="contained" size="large" disabled={submitting}>
          Зарегистрироваться
        </Button>
      </Stack>
    </Stack>
  )
}
