'use client'

import { useState } from 'react'

import { Alert, Button, Stack } from '@repo/ui/components'

export type InviteKind = 'invite' | 'join' | 'guest'

/**
 * The only client island of the `(invite)` segment. Acceptance goes through
 * `POST /api/invite/accept` (a route handler over the protected tRPC caller)
 * instead of a browser tRPC client — keeps tRPC/React Query out of this
 * public segment entirely.
 */
export function AcceptButton({ kind, token }: { kind: InviteKind; token: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAccept = async () => {
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, token }),
      })
      const data = (await res.json().catch(() => null)) as {
        redirectTo?: string
        error?: string
      } | null
      if (!res.ok) {
        setError(data?.error ?? 'Не удалось принять приглашение. Попробуйте позже.')
        setPending(false)
        return
      }
      // Full navigation so the protected tree renders with the new membership.
      window.location.assign(data?.redirectTo ?? '/app')
    } catch {
      setError('Не удалось принять приглашение. Попробуйте позже.')
      setPending(false)
    }
  }

  return (
    <Stack spacing={1.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Button
        fullWidth
        variant="contained"
        onClick={handleAccept}
        disabled={pending}
        data-testid="invite-accept"
      >
        {pending ? 'Принимаем…' : 'Принять приглашение'}
      </Button>
    </Stack>
  )
}
