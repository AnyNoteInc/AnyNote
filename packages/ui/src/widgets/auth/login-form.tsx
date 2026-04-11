"use client"

import { useForm } from "react-hook-form"
import { Divider, TextField, Button, Stack, Typography } from "@repo/ui/components"

export type LoginFormValues = {
  email: string
  password: string
}

export type LoginFormProps = {
  defaultValues?: Partial<LoginFormValues>
  onSubmit?: (values: LoginFormValues) => void | Promise<void>
  onGoogle?: () => void
  titleLabel?: string
  submitLabel?: string
  isSubmitting?: boolean
}

export function LoginForm({
  defaultValues,
  onSubmit,
  onGoogle,
  titleLabel = "Авторизация",
  submitLabel = "Войти",
  isSubmitting,
}: LoginFormProps) {
  const formDefaults = {
    email: "",
    password: "",
    ...defaultValues,
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<LoginFormValues>({
    defaultValues: formDefaults,
    mode: "onSubmit",
    reValidateMode: "onChange",
  })

  const submitting = isSubmitting ?? rhfSubmitting

  const handleFormSubmit = handleSubmit(async (values) => {
    await onSubmit?.(values)
  })

  return (
    <Stack spacing={3} component="form" onSubmit={handleFormSubmit}>
      <Stack spacing={0.5} textAlign="center">
        <Typography variant="h4" fontWeight={700}>
          {titleLabel}
        </Typography>
      </Stack>
      <Divider />
      <Stack spacing={2.5}>
        <TextField
          {...register("email", {
            required: "Введите ник пользователя",
            pattern: {
              value: /\S+@\S+\.\S+/,
              message: "Введите корректный email",
            },
          })}
          label="Email"
          fullWidth
          autoComplete="email"
          error={!!errors.email}
          helperText={errors.email?.message}
        />
        <TextField
          {...register("password", { required: "Введите пароль" })}
          label="Пароль"
          type="password"
          fullWidth
          autoComplete="current-password"
          error={!!errors.password}
          helperText={errors.password?.message}
        />
        <Button type="submit" variant="contained" size="large" disabled={submitting}>
          {submitLabel}
        </Button>
      </Stack>

      <Stack spacing={2}>
        <Divider>или</Divider>
        <Button variant="outlined" size="large" onClick={() => onGoogle?.()} disabled={submitting}>
          Войти через Google
        </Button>
      </Stack>
    </Stack>
  )
}
