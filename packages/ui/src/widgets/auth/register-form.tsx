"use client"

import { useForm } from "react-hook-form"
import { Stack, TextField, Button, Divider, Typography } from "@repo/ui/components"

export type RegisterFormValues = {
  email: string
  firstName: string
  lastName: string
  password: string
  confirmPassword: string
}

export type RegisterSubmitPayload = Omit<RegisterFormValues, "confirmPassword">

export type RegisterFormProps = {
  defaultValues?: Partial<RegisterFormValues>
  onSubmit?: (values: RegisterSubmitPayload) => Promise<void>
  titleLabel?: string
  submitLabel?: string
  isSubmitting?: boolean
}

export function RegisterForm({
  defaultValues,
  onSubmit,
  titleLabel = "Регистрация",
  submitLabel = "Зарегистрироваться",
  isSubmitting,
}: RegisterFormProps) {
  const formDefaults: RegisterFormValues = {
    email: "",
    lastName: "",
    firstName: "",
    password: "",
    confirmPassword: "",
    ...defaultValues,
  }

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<RegisterFormValues>({
    defaultValues: formDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  })

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(async ({ confirmPassword, ...values }) => {
    if (values.password !== confirmPassword) {
      setError("confirmPassword", {
        type: "validate",
        message: "Пароли не совпадают",
      })
      return
    }
    await onSubmit?.(values)
  })

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <Stack spacing={0.5} textAlign="center">
        <Typography variant="h4" fontWeight={700}>
          {titleLabel}
        </Typography>
      </Stack>
      <Stack spacing={2.5}>
        <TextField
          {...register("email", {
            required: "Введите email",
            pattern: {
              value: /\S+@\S+\.\S+/,
              message: "Введите корректный email",
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
          {...register("lastName", { required: "Введите фамилию" })}
          label="Фамилия"
          fullWidth
          autoComplete="family-name"
          error={!!errors.lastName}
          helperText={errors.lastName?.message}
        />
        <TextField
          {...register("firstName", { required: "Введите имя" })}
          label="Имя"
          fullWidth
          autoComplete="given-name"
          error={!!errors.firstName}
          helperText={errors.firstName?.message}
        />
        <Divider />
        <TextField
          {...register("password", {
            required: "Введите пароль",
            minLength: { value: 8, message: "Минимум 8 символов" },
          })}
          label="Пароль"
          type="password"
          fullWidth
          autoComplete="new-password"
          error={!!errors.password}
          helperText={errors.password?.message}
        />
        <TextField
          {...register("confirmPassword", {
            required: "Повторите пароль",
          })}
          label="Повторите пароль"
          type="password"
          fullWidth
          autoComplete="new-password"
          error={!!errors.confirmPassword}
          helperText={errors.confirmPassword?.message}
        />
        <Button type="submit" variant="contained" size="large" disabled={submitting}>
          {submitLabel}
        </Button>
      </Stack>
    </Stack>
  )
}
