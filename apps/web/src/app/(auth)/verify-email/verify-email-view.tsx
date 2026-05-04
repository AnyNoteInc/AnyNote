'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Alert, Button, Stack, Typography } from '@repo/ui/components'
import { AuthHeader } from '@repo/ui/widgets'

export type VerifyEmailStatus = 'success' | 'error' | 'expired' | 'pending'

export function VerifyEmailView({ status }: { status: VerifyEmailStatus }) {
  const router = useRouter()

  useEffect(() => {
    if (status !== 'success') return
    const timer = setTimeout(() => {
      router.push('/app')
      router.refresh()
    }, 2000)
    return () => clearTimeout(timer)
  }, [status, router])

  return (
    <Stack spacing={3}>
      <AuthHeader title="Подтверждение email" />
      {status === 'success' ? (
        <Alert severity="success">Email подтверждён. Перенаправляем в приложение...</Alert>
      ) : null}
      {status === 'pending' ? (
        <Alert severity="info">Проверьте почту: мы отправили ссылку для подтверждения email.</Alert>
      ) : null}
      {status === 'error' || status === 'expired' ? (
        <>
          <Alert severity="error">
            Ссылка недействительна или истекла. Пожалуйста, запросите подтверждение заново.
          </Alert>
          <Button component={Link} href="/sign-in" variant="contained" fullWidth>
            Перейти ко входу
          </Button>
        </>
      ) : null}
      {status !== 'success' && status !== 'error' && status !== 'expired' ? (
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Не получили письмо? Проверьте папку Спам.
        </Typography>
      ) : null}
    </Stack>
  )
}
