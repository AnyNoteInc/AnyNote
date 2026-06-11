import { NextResponse, type NextRequest } from 'next/server'

import { INVITE_RETURN_COOKIE, INVITE_RETURN_MAX_AGE, isInvitePath } from '@/lib/invite'

export const runtime = 'nodejs'

/**
 * Auth hand-off for the invite pages: stores the invite path in a short-TTL
 * httpOnly cookie, then forwards to the requested auth page. Sign-in also
 * gets the path as `?redirect=` (its form honors it directly); sign-up can't
 * carry a return URL through email verification, so the cookie — consumed
 * once by the `(protected)` layout via `/api/invite/return/consume` — is the
 * mechanism that survives that flow.
 */
export function GET(req: NextRequest): NextResponse {
  const to = req.nextUrl.searchParams.get('to') ?? ''
  if (!isInvitePath(to)) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  const mode = req.nextUrl.searchParams.get('mode')
  const target =
    mode === 'signup' ? '/sign-up' : `/sign-in?redirect=${encodeURIComponent(to)}`

  const res = NextResponse.redirect(new URL(target, req.url))
  res.cookies.set(INVITE_RETURN_COOKIE, to, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: INVITE_RETURN_MAX_AGE,
  })
  return res
}
