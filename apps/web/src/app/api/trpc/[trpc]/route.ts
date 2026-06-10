import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter, createContext } from '@repo/trpc'
import { getYookassaClient, getReturnUrlBase } from '@/server/yookassa'
import { kickJob } from '@/server/jobs/kick'
import '@/lib/register-consent-versions'

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
        jobs: { kick: kickJob },
      }),
  })

export { handler as GET, handler as POST }
