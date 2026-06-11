import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@repo/auth'
import { getSession } from '@/lib/get-session'

// Same-origin relative paths only (rejects `//host` and `/\host`) — the
// «Сменить аккаунт» flow on invite pages signs out and returns to sign-in
// with the invite path as its redirect target.
function safeTarget(raw: string | undefined): string {
  return raw && /^\/[^/\\]/.test(raw) ? raw : '/'
}

export default async function SignOutPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>
}) {
  const { redirect: target } = await searchParams
  if (await getSession()) {
    await auth.api.signOut({
      headers: await headers(),
    })
  }
  redirect(safeTarget(target))
}
