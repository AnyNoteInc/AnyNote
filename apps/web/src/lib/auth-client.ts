'use client'

import { createAuthClient } from 'better-auth/react'
import {
  jwtClient,
  customSessionClient,
  magicLinkClient,
  deviceAuthorizationClient,
  lastLoginMethodClient,
} from 'better-auth/client/plugins'
import { auth } from '@repo/auth'

const baseURL =
  typeof window === 'undefined' ? process.env.NEXT_PUBLIC_BASE_URL! : window.location.origin

type PasswordResetArgs = {
  email: string
  redirectTo?: string
  fetchOptions?: { headers?: Record<string, string> }
}

export type AuthClient = {
  requestPasswordReset?: (args: PasswordResetArgs) => Promise<{ error?: { message?: string } | null }>
  forgetPassword?: (args: PasswordResetArgs) => Promise<{ error?: { message?: string } | null }>
  resetPassword: (args: {
    newPassword: string
    token: string
  }) => Promise<{ error?: { message?: string } | null }>
}

const client = createAuthClient({
  baseURL,
  plugins: [
    jwtClient(),
    customSessionClient<typeof auth>(),
    deviceAuthorizationClient(),
    lastLoginMethodClient(),
    magicLinkClient(),
  ],
  fetchOptions: {
    onError(e) {
      if (e.error.status === 429) {
        console.log(e)
      }
    },
  },
})

export const authClient = client as unknown as AuthClient
export const { signIn, signUp, signOut, useSession } = client
