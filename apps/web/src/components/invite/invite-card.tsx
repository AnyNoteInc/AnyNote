import Link from 'next/link'

import { Button, Stack, Typography } from '@repo/ui/components'

import { AcceptButton, type InviteKind } from './accept-button'

export type InviteResolveState = 'PENDING' | 'EXPIRED' | 'REVOKED' | 'ACCEPTED' | 'NOT_FOUND'

/** What the card actually shows — `data-state` on the `invite-state` testid. */
type DisplayState =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'REVOKED'
  | 'ACCEPTED'
  | 'SIGNED_OUT'
  | 'EMAIL_MISMATCH'
  | 'READY'

const MEMBER_ROLE_LABELS: Record<string, string> = {
  OWNER: 'Владелец',
  ADMIN: 'Администратор',
  EDITOR: 'Редактор',
  COMMENTER: 'Комментатор',
  VIEWER: 'Читатель',
}

const GUEST_ROLE_LABELS: Record<string, string> = {
  READER: 'Читатель',
  COMMENTER: 'Комментатор',
  EDITOR: 'Редактор',
}

const TERMINAL_COPY: Record<Exclude<DisplayState, 'SIGNED_OUT' | 'EMAIL_MISMATCH' | 'READY'>, {
  title: string
  body: string
}> = {
  NOT_FOUND: {
    title: 'Приглашение не найдено',
    body: 'Ссылка недействительна: приглашение не существует или было отключено.',
  },
  EXPIRED: {
    title: 'Срок приглашения истёк',
    body: 'Это приглашение больше не действует. Попросите отправить вам новое.',
  },
  REVOKED: {
    title: 'Приглашение отозвано',
    body: 'Это приглашение было отозвано. Попросите отправить вам новое.',
  },
  ACCEPTED: {
    title: 'Приглашение уже принято',
    body: 'Это приглашение уже было использовано.',
  },
}

function pendingTitle(kind: InviteKind, workspaceName: string | null): string {
  const ws = workspaceName ? `«${workspaceName}»` : ''
  switch (kind) {
    case 'guest':
      return `Вам открыли доступ к странице в пространстве ${ws}`.trim()
    default:
      return `Приглашение в пространство ${ws}`.trim()
  }
}

function LinkButton({
  href,
  children,
  variant = 'contained',
  testId,
}: {
  href: string
  children: React.ReactNode
  variant?: 'contained' | 'outlined'
  testId?: string
}) {
  // RSC boundary: never pass `Link` (a function) as `component=` — wrap instead.
  return (
    <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>
      <Button fullWidth variant={variant} data-testid={testId}>
        {children}
      </Button>
    </Link>
  )
}

export type InviteCardProps = {
  kind: InviteKind
  token: string
  state: InviteResolveState
  workspaceName: string | null
  inviterName: string | null
  role: string | null
  maskedEmail: string | null
  /** null ⇒ signed out. */
  sessionEmail: string | null
  /** Always true for join links (no email constraint). */
  emailMatches: boolean
}

export function InviteCard({
  kind,
  token,
  state,
  workspaceName,
  inviterName,
  role,
  maskedEmail,
  sessionEmail,
  emailMatches,
}: InviteCardProps) {
  const invitePath = `/${kind === 'invite' ? 'invite' : kind === 'join' ? 'join' : 'guest-invite'}/${token}`
  const roleLabel = role
    ? ((kind === 'guest' ? GUEST_ROLE_LABELS : MEMBER_ROLE_LABELS)[role] ?? null)
    : null

  let displayState: DisplayState
  if (state !== 'PENDING') displayState = state
  else if (!sessionEmail) displayState = 'SIGNED_OUT'
  else if (!emailMatches) displayState = 'EMAIL_MISMATCH'
  else displayState = 'READY'

  if (displayState !== 'SIGNED_OUT' && displayState !== 'EMAIL_MISMATCH' && displayState !== 'READY') {
    const copy = TERMINAL_COPY[displayState]
    return (
      <Stack spacing={2} data-testid="invite-state" data-state={displayState}>
        <Typography variant="h5" component="h1">
          {copy.title}
        </Typography>
        <Typography color="text.secondary">{copy.body}</Typography>
        {displayState === 'ACCEPTED' ? (
          <LinkButton href={sessionEmail ? '/app' : '/sign-in'} variant="outlined">
            {sessionEmail ? 'Перейти в приложение' : 'Войти'}
          </LinkButton>
        ) : (
          <LinkButton href="/" variant="outlined">
            На главную
          </LinkButton>
        )}
      </Stack>
    )
  }

  const details = (
    <Stack spacing={0.5}>
      {inviterName ? (
        <Typography color="text.secondary">{inviterName} приглашает вас.</Typography>
      ) : null}
      {roleLabel ? <Typography color="text.secondary">Роль: {roleLabel}.</Typography> : null}
    </Stack>
  )

  if (displayState === 'SIGNED_OUT') {
    const returnHref = (mode: 'signin' | 'signup') =>
      `/api/invite/return?to=${encodeURIComponent(invitePath)}&mode=${mode}`
    return (
      <Stack spacing={2} data-testid="invite-state" data-state="SIGNED_OUT">
        <Typography variant="h5" component="h1">
          {pendingTitle(kind, workspaceName)}
        </Typography>
        {details}
        {maskedEmail ? (
          <Typography color="text.secondary">
            Приглашение отправлено на {maskedEmail}. Войдите или зарегистрируйтесь с этим адресом,
            чтобы принять его.
          </Typography>
        ) : (
          <Typography color="text.secondary">
            Войдите или зарегистрируйтесь, чтобы присоединиться.
          </Typography>
        )}
        <Stack spacing={1.5}>
          <LinkButton href={returnHref('signin')}>Войти</LinkButton>
          <LinkButton href={returnHref('signup')} variant="outlined">
            Зарегистрироваться
          </LinkButton>
        </Stack>
      </Stack>
    )
  }

  if (displayState === 'EMAIL_MISMATCH') {
    const signInBack = `/sign-in?redirect=${encodeURIComponent(invitePath)}`
    const switchHref = `/sign-out?redirect=${encodeURIComponent(signInBack)}`
    return (
      <Stack spacing={2} data-testid="invite-state" data-state="EMAIL_MISMATCH">
        <Typography variant="h5" component="h1">
          Приглашение для другого адреса
        </Typography>
        <Typography color="text.secondary">
          Это приглашение отправлено на {maskedEmail ?? 'другой адрес'}, а вы вошли как{' '}
          {sessionEmail}. Войдите с адресом, на который пришло приглашение.
        </Typography>
        <LinkButton href={switchHref} variant="outlined">
          Сменить аккаунт
        </LinkButton>
      </Stack>
    )
  }

  return (
    <Stack spacing={2} data-testid="invite-state" data-state="READY">
      <Typography variant="h5" component="h1">
        {pendingTitle(kind, workspaceName)}
      </Typography>
      {details}
      <AcceptButton kind={kind} token={token} />
    </Stack>
  )
}
