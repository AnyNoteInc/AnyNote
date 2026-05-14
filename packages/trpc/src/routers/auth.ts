import { z } from 'zod'

import { auth } from '@repo/auth'
import { ConsentSource } from '@repo/db'

import { router, publicProcedure } from '../trpc'
import { extractIpAddress, extractUserAgent, writeConsentBatch } from '../lib/consents'

export const authRouter = router({
  signUp: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(8),
        firstName: z.string().min(1).max(255),
        lastName: z.string().min(1).max(255),
        marketing: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const fullName = `${input.lastName} ${input.firstName}`

      const result = await auth.api.signUpEmail({
        body: {
          email: input.email,
          password: input.password,
          name: fullName,
          firstName: input.firstName,
          lastName: input.lastName,
          callbackURL: '/verify-email?status=success',
        },
        headers: ctx.headers,
        asResponse: false,
      })

      await writeConsentBatch(ctx.prisma, {
        userId: result.user.id,
        marketing: input.marketing,
        source: ConsentSource.SIGN_UP,
        ipAddress: extractIpAddress(ctx.headers),
        userAgent: extractUserAgent(ctx.headers),
      })

      return { success: true }
    }),
})
