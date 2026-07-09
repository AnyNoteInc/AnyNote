import 'server-only'

import { cache } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@repo/auth'

async function getUserSession() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })
  if (!session) return null
  // `firstName`/`lastName` are declared `required: false` on the better-auth
  // user (so @better-auth/sso's pre-hook required-field validation does not
  // reject name-only IdP sign-ups — see packages/auth/src/auth.ts), which makes
  // better-auth infer them as `string | null | undefined`. But the Postgres
  // columns are NOT NULL and the `create.before` hook always fills them, so at
  // read time they are always strings. Normalize the pessimistic type back to
  // `string` here, at the single session boundary, so consumers keep their
  // non-null contract without a null-coalescing ripple across the app.
  return {
    ...session,
    user: {
      ...session.user,
      firstName: session.user.firstName ?? '',
      lastName: session.user.lastName ?? '',
    },
  }
}

export const getSession = cache(getUserSession)

export type SessionType = Awaited<ReturnType<typeof getUserSession>>

export async function requireSession(redirectTo = '/sign-in') {
  const session = await getSession()
  if (!session) {
    redirect(redirectTo)
  }
  return session
}
