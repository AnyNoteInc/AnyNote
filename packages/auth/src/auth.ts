import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import {
  magicLink,
  bearer,
  jwt,
  deviceAuthorization,
  lastLoginMethod,
} from 'better-auth/plugins'
import { nextCookies } from 'better-auth/next-js'

import { prisma, SubscriptionStatus } from '@repo/db'
import { enqueueMailEvent } from '@repo/mail'

const VERIFY_EXPIRES_S = 60 * 60 * 3

function appUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
}

const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // Will be replaced in Task 10 with enqueueMailEvent flow.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'sendResetPassword is not wired to a real transport. Configure email delivery before enabling password reset in production.',
        )
      }
      console.info(`Password reset link for ${user.email}: ${url}`)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFY_EXPIRES_S,
    sendVerificationEmail: async ({ user, url }) => {
      const expiresAtIso = new Date(Date.now() + VERIFY_EXPIRES_S * 1000).toISOString()
      const userWithName = user as { firstName?: string; email: string; id: string }
      await enqueueMailEvent(prisma, {
        kind: 'verify-email',
        to: userWithName.email,
        data: {
          firstName: userWithName.firstName ?? '',
          link: url,
          expiresAtIso,
        },
        userId: userWithName.id,
      })
    },
    afterEmailVerification: async (user) => {
      const userWithName = user as { firstName?: string; email: string; id: string }
      await enqueueMailEvent(prisma, {
        kind: 'welcome',
        to: userWithName.email,
        data: {
          firstName: userWithName.firstName ?? '',
          appUrl: `${appUrl()}/app`,
        },
        userId: userWithName.id,
      })
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
  user: {
    additionalFields: {
      firstName: { type: 'string', required: true },
      lastName: { type: 'string', required: true },
    },
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
      : {}),
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (process.env.NODE_ENV !== 'production') {
          console.info(`Magic link for ${email}: ${url}`)
        }
      },
    }),
    deviceAuthorization({
      expiresIn: '3min',
      interval: '5s',
    }),
    bearer(),
    nextCookies(),
    jwt({
      jwt: {
        issuer: process.env.BETTER_AUTH_URL,
      },
    }),
    lastLoginMethod(),
  ],
  session: {
    storeSessionInDatabase: true,
  },
  experimental: { joins: true },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const personalPlan = await prisma.plan.findUniqueOrThrow({
            where: { slug: 'personal' },
          })
          await prisma.subscription.create({
            data: {
              userId: user.id,
              planId: personalPlan.id,
              status: SubscriptionStatus.ACTIVE,
              billingPeriod: 'MONTHLY',
              currentPeriodStart: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
            },
          })
          await prisma.userPreference.upsert({
            where: { userId: user.id },
            create: { userId: user.id },
            update: {},
          })
        },
      },
    },
  },
})

export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session

export { auth }
