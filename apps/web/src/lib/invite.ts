import 'server-only'

import { prisma } from '@repo/db'
import { hashInviteToken } from '@repo/domain'

/**
 * Post-auth return cookie for the token-acceptance pages.
 *
 * Sign-in honors `?redirect=` end-to-end, but sign-up cannot carry a return
 * URL: the verification mail's callback is hardcoded to
 * `/verify-email?status=success` (packages/trpc auth.signUp), so the invite
 * pages route their auth CTAs through `/api/invite/return`, which stores the
 * invite path in this httpOnly cookie. The `(protected)` layout consumes it
 * exactly once via `/api/invite/return/consume` (route handlers are the only
 * place Next allows cookie deletion).
 */
export const INVITE_RETURN_COOKIE = 'invite_return'

/** 30 minutes — long enough to finish email verification, short enough to forget. */
export const INVITE_RETURN_MAX_AGE = 30 * 60

/** Generated invite tokens are 32 base62 chars; the tRPC schema admits 8–64. */
const TOKEN_RE = /^[A-Za-z0-9]{8,64}$/

export function isWellFormedInviteToken(token: string): boolean {
  return TOKEN_RE.test(token)
}

/** Only the three acceptance pages are valid return targets — never an open redirect. */
const INVITE_PATH_RE = /^\/(invite|join|guest-invite)\/[A-Za-z0-9]{8,64}$/

export function isInvitePath(path: string): boolean {
  return INVITE_PATH_RE.test(path)
}

/**
 * Does the signed-in user's email match the invite's target email?
 *
 * The public resolve procedures intentionally return only a MASKED email, so
 * the mismatch state can't be derived from their payload. This server-only
 * lookup compares the plaintext emails without widening the public surface.
 * Join links carry no email constraint and never call this.
 */
export async function inviteEmailMatches(
  kind: 'invite' | 'guest',
  token: string,
  sessionEmail: string,
): Promise<boolean> {
  const tokenHash = hashInviteToken(token)
  const row =
    kind === 'invite'
      ? await prisma.workspaceInvitation.findUnique({ where: { tokenHash }, select: { email: true } })
      : await prisma.pageGuestInvite.findUnique({ where: { tokenHash }, select: { email: true } })
  return row !== null && row.email.toLowerCase() === sessionEmail.toLowerCase()
}
