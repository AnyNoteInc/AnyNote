"use client"

import { createAuthClient } from "better-auth/react"
import {
  jwtClient,
  customSessionClient,
  magicLinkClient,
  deviceAuthorizationClient,
  lastLoginMethodClient,
} from "better-auth/client/plugins"
import { auth } from "@repo/auth"

const baseURL =
  typeof window === "undefined" ? process.env.NEXT_PUBLIC_BASE_URL! : window.location.origin

export const { signIn, signUp, signOut, useSession } = createAuthClient({
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
