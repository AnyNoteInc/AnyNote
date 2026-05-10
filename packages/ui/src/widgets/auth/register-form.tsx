'use client'

import { useForm, type FieldErrors, type UseFormRegister } from 'react-hook-form'

import {
  Button,
  Divider,
  KeyboardDoubleArrowLeftIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { AuthHeader } from './auth-header'
import {
  ConsentsCheckboxes,
  type ConsentsCheckboxesUrls,
  type ConsentsCheckboxesValues,
} from './consents-checkboxes'

export type RegisterFormValues = {
  email: string
  firstName: string
  lastName: string
  password: string
  confirmPassword: string
  agreedToTerms: boolean
  agreedToMarketing: boolean
}

export type RegisterSubmitPayload = Omit<
  RegisterFormValues,
  'confirmPassword' | 'agreedToTerms'
>

export type TermsUrls = ConsentsCheckboxesUrls

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
}: Readonly<RegisterFormProps>) {
  const formDefaults: RegisterFormValues = {
    email: '',
    lastName: '',
    firstName: '',
    password: '',
    confirmPassword: '',
    agreedToTerms: false,
    agreedToMarketing: false,
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
      setError('confirmPassword', { type: 'validate', message: 'Пароли не совпадают' })
      return
    }
    const { email, firstName, lastName, password, agreedToMarketing } = formValues
    await onSubmit?.({ email, firstName, lastName, password, agreedToMarketing })
  })

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <AuthHeader title="Регистрация" />
      <Stack spacing={2.5}>
        <TextField
          {...register('email', {
            required: 'Введите email',
            pattern: { value: /\S+@\S+\.\S+/, message: 'Введите корректный email' },
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
          {...register('confirmPassword', { required: 'Повторите пароль' })}
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
          <ConsentsCheckboxes
            register={register as unknown as UseFormRegister<ConsentsCheckboxesValues>}
            errors={errors as FieldErrors<ConsentsCheckboxesValues>}
            urls={termsUrls}
          />
        ) : null}
        <Button type="submit" variant="contained" size="large" disabled={submitting}>
          Зарегистрироваться
        </Button>
      </Stack>
    </Stack>
  )
}
