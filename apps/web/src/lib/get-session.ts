import "server-only"

import { cache } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@repo/auth"

async function getUserSession() {
  return auth.api.getSession({
    headers: await headers(),
  })
}

export const getSession = cache(getUserSession)

export type SessionType = Awaited<ReturnType<typeof getUserSession>>

export async function requireSession(redirectTo = "/sign-in") {
  const session = await getSession()
  if (!session) {
    redirect(redirectTo)
  }
  return session
}
