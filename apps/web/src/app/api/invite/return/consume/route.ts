import { NextResponse, type NextRequest } from 'next/server'

import { INVITE_RETURN_COOKIE, isInvitePath } from '@/lib/invite'

export const runtime = 'nodejs'

/**
 * One-shot consumer of the post-auth invite-return cookie. The `(protected)`
 * layout redirects here when the cookie is present; this handler deletes it
 * (layouts cannot modify cookies) and forwards to the stored invite page —
 * deletion-before-redirect makes the bounce exactly-once, loop-free.
 */
export function GET(req: NextRequest): NextResponse {
  const stored = req.cookies.get(INVITE_RETURN_COOKIE)?.value ?? ''
  const target = isInvitePath(stored) ? stored : '/app'
  const res = NextResponse.redirect(new URL(target, req.url))
  res.cookies.set(INVITE_RETURN_COOKIE, '', { maxAge: 0, path: '/' })
  return res
}
