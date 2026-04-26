import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter, createContext } from '@repo/trpc'
import { getYookassaClient, getReturnUrlBase } from '@/server/yookassa'

export const runtime = 'nodejs'

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: ({ req, resHeaders }) =>
      createContext({
        req,
        resHeaders,
        yookassa: getYookassaClient(),
        returnUrlBase: getReturnUrlBase(),
      }),
  })

export { handler as GET, handler as POST }
