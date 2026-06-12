import { NextResponse, type NextRequest } from 'next/server'
import { TRPCError } from '@trpc/server'

import { getSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { INVITE_RETURN_COOKIE, isWellFormedInviteToken } from '@/lib/invite'

export const runtime = 'nodejs'

const KINDS = ['invite', 'join', 'guest'] as const
type Kind = (typeof KINDS)[number]

// The domain throws Russian-copy DomainErrors; surface them with honest statuses.
const TRPC_STATUS: Partial<Record<TRPCError['code'], number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PRECONDITION_FAILED: 412,
}

/**
 * CSRF hardening: this endpoint is cookie-authenticated and mutating, so a
 * cross-site POST must not be able to accept an invite with the victim's
 * session. Browsers always attach `Origin` to POST requests; require it to
 * match the app's own origin exactly. When `NEXT_PUBLIC_BASE_URL` is unset
 * (tests, ad-hoc envs) fall back to the origin implied by the request's own
 * Host header.
 */
function isSameAppOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  const base = process.env.NEXT_PUBLIC_BASE_URL
  try {
    const expected = base
      ? new URL(base).origin
      : new URL(`${new URL(req.url).protocol}//${req.headers.get('host') ?? ''}`).origin
    return new URL(origin).origin === expected
  } catch {
    return false
  }
}

/**
 * Acceptance endpoint for the public `(invite)` pages — the segment stays
 * RSC-pure (no browser tRPC client), so the client accept button POSTs here
 * and this handler drives the protected tRPC caller (`getServerTRPC`, the
 * same pattern RSC pages use; the session is resolved from request cookies).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isSameAppOrigin(req)) {
    return NextResponse.json({ error: 'Недопустимый источник запроса' }, { status: 403 })
  }

  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Требуется вход' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as { kind?: unknown; token?: unknown } | null
  const kind = body?.kind
  const token = body?.token
  if (
    typeof kind !== 'string' ||
    !KINDS.includes(kind as Kind) ||
    typeof token !== 'string' ||
    !isWellFormedInviteToken(token)
  ) {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  const trpc = await getServerTRPC()
  try {
    let workspaceId: string
    let redirectTo: string
    if (kind === 'guest') {
      const result = await trpc.people.acceptGuestInvite({ token })
      workspaceId = result.workspaceId
      redirectTo = `/pages/${result.pageId}`
    } else if (kind === 'join') {
      const result = await trpc.people.joinViaLink({ token })
      workspaceId = result.workspaceId
      redirectTo = '/app'
    } else {
      const result = await trpc.people.acceptInvite({ token })
      workspaceId = result.workspaceId
      redirectTo = '/app'
    }

    // Scope the session to the accepted workspace so `/app` (and the sidebar)
    // land there. A default-scope hint only — never authorization — so a
    // failure must not mask the successful acceptance.
    await trpc.workspace.setActive({ workspaceId }).catch(() => {})

    const res = NextResponse.json({ redirectTo })
    // The post-auth return is fulfilled — never bounce back to this invite.
    res.cookies.set(INVITE_RETURN_COOKIE, '', { maxAge: 0, path: '/' })
    return res
  } catch (error) {
    if (error instanceof TRPCError) {
      return NextResponse.json(
        { error: error.message },
        { status: TRPC_STATUS[error.code] ?? 500 },
      )
    }
    throw error
  }
}
