'use client'

import { useState, type PropsWithChildren } from 'react'

import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { httpBatchLink } from '@trpc/client'
import { type CreateTRPCReact, createTRPCReact } from '@trpc/react-query'

import type { AppRouter } from '@repo/trpc'

import { consumePendingCaptchaToken } from '@/lib/captcha-token-store'

import { getQueryClient } from './query-client'

export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>()

function getBaseUrl() {
  if (typeof window !== 'undefined') {
    return window.location.origin
  }
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
}

export function TRPCReactProvider({ children }: PropsWithChildren) {
  const queryClient = getQueryClient()
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          headers() {
            const token = consumePendingCaptchaToken()
            return token ? { 'x-captcha-response': token } : {}
          },
        }),
      ],
    }),
  )

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        {children}
        {process.env.NODE_ENV === 'development' ? (
          <ReactQueryDevtools initialIsOpen={false} />
        ) : null}
      </trpc.Provider>
    </QueryClientProvider>
  )
}
