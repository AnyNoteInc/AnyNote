'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import type { PublicUnavailableReason } from '@repo/domain'
import {
  Alert,
  Box,
  Button,
  LockIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

// Russian copy per resolver reason. `not_found` never reaches here (the route
// 404s for it); `password_required` renders the gate instead of a flat message.
const MESSAGES: Record<Exclude<PublicUnavailableReason, 'not_found' | 'password_required'>, string> =
  {
    disabled: 'Доступ закрыт',
    unpublished: 'Страница не опубликована',
    expired: 'Срок действия ссылки истёк',
    not_yet_exposed: 'Публикация ещё не началась',
    restricted_child: 'Эта страница недоступна',
    // The 8C security-policy kill-switch — an honest state, never a silent 404.
    policy_disabled: 'Доступ по ссылке отключён администратором пространства',
  }

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 360, width: '100%' }}>
        {children}
      </Stack>
    </Box>
  )
}

export function ShareUnavailable({ reason }: { reason: PublicUnavailableReason }) {
  if (reason === 'password_required') {
    // The shareId is needed to validate the password; this branch is rendered
    // by SharePasswordGate directly (see the route), but guard anyway.
    return (
      <Centered>
        <LockIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
        <Typography variant="h6">Требуется пароль</Typography>
      </Centered>
    )
  }

  const message = reason === 'not_found' ? 'Страница недоступна' : MESSAGES[reason]
  return (
    <Centered>
      <LockIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
      <Typography variant="h6">{message}</Typography>
      <Typography color="text.secondary" textAlign="center">
        Открывать этот контент могут только пользователи, имеющие доступ.
      </Typography>
    </Centered>
  )
}

/**
 * Password gate for `password_required`. On a valid password it writes the
 * accepted value into the `pw` search param and refreshes; the RSC re-runs
 * `resolveShareAccess(..., { password })` and renders the page. The password
 * is user-supplied each request, so the resolver re-validates it every time.
 */
export function SharePasswordGate({ shareId }: { shareId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const validate = trpc.page.share.validateSharePassword.useMutation()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await validate.mutateAsync({ shareId, password })
      if (!res.valid) {
        setError('Неверный пароль')
        return
      }
      const next = new URLSearchParams(searchParams.toString())
      next.set('pw', password)
      router.replace(`?${next.toString()}`)
      router.refresh()
    } catch {
      setError('Не удалось проверить пароль')
    }
  }

  return (
    <Centered>
      <LockIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
      <Typography variant="h6">Требуется пароль</Typography>
      <Typography color="text.secondary" textAlign="center">
        Эта страница защищена паролем. Введите его, чтобы продолжить.
      </Typography>
      <Box component="form" onSubmit={submit} sx={{ width: '100%' }}>
        <Stack spacing={1.5}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            type="password"
            label="Пароль"
            size="small"
            fullWidth
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!password || validate.isPending}
            fullWidth
          >
            Открыть
          </Button>
        </Stack>
      </Box>
    </Centered>
  )
}
