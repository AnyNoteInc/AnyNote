import 'server-only'

import { cache } from 'react'
import { headers } from 'next/headers'

import { createCaller, createServerContext } from '@repo/trpc'
import { getYookassaClient, getReturnUrlBase } from '@/server/yookassa'

export const getServerTRPC = cache(async () => {
  const heads = new Headers(await headers())
  heads.set('x-trpc-source', 'rsc')
  const ctx = await createServerContext(heads, getYookassaClient(), getReturnUrlBase())
  return createCaller(ctx)
})
