import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { auth } from '@repo/auth'
import { getSession } from '@/lib/get-session'

export default async function SignOutPage() {
  if (await getSession()) {
    await auth.api.signOut({
      headers: await headers(),
    })
  }
  redirect('/')
}
