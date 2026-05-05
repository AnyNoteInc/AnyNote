import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import {
  magicLink,
  bearer,
  jwt,
  deviceAuthorization,
  lastLoginMethod,
  captcha,
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
    resetPasswordTokenExpiresIn: VERIFY_EXPIRES_S,
    sendResetPassword: async ({ user, token }) => {
      const userWithName = user as { firstName?: string; email: string; id: string }
      const link = `${appUrl()}/reset-credentials/${token}`
      const expiresAtIso = new Date(Date.now() + VERIFY_EXPIRES_S * 1000).toISOString()
      await enqueueMailEvent(prisma, {
        kind: 'reset-password',
        to: userWithName.email,
        data: {
          firstName: userWithName.firstName ?? '',
          link,
          expiresAtIso,
        },
        userId: userWithName.id,
      })
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
            mapProfileToUser: (profile) => {
              const fallback = profile.name?.trim().split(/\s+/) ?? []
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                emailVerified: profile.email_verified,
                image: profile.picture,
                firstName: profile.given_name?.trim() || fallback[0] || '',
                lastName: profile.family_name?.trim() || fallback.slice(1).join(' ') || '',
              }
            },
          },
        }
      : {}),
  },
  plugins: [
    ...(process.env.RECAPTCHA_SECRET_KEY
      ? [
          captcha({
            provider: 'google-recaptcha',
            secretKey: process.env.RECAPTCHA_SECRET_KEY,
            minScore: 0.5,
            endpoints: ['/sign-in/email', '/sign-up/email', '/request-password-reset'],
          }),
        ]
      : []),
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
        audience: process.env.BETTER_AUTH_JWT_AUDIENCE,
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
          const userWithName = user as {
            id: string
            email: string
            emailVerified: boolean
            firstName?: string
          }
          const personalPlan = await prisma.plan.findUniqueOrThrow({
            where: { slug: 'personal' },
          })
          await prisma.subscription.create({
            data: {
              userId: userWithName.id,
              planId: personalPlan.id,
              status: SubscriptionStatus.ACTIVE,
              billingPeriod: 'MONTHLY',
              currentPeriodStart: null,
              currentPeriodEnd: null,
              cancelAtPeriodEnd: false,
            },
          })
          await prisma.userPreference.upsert({
            where: { userId: userWithName.id },
            create: { userId: userWithName.id },
            update: {},
          })
          if (userWithName.emailVerified) {
            await enqueueMailEvent(prisma, {
              kind: 'welcome',
              to: userWithName.email,
              data: {
                firstName: userWithName.firstName ?? '',
                appUrl: `${appUrl()}/app`,
              },
              userId: userWithName.id,
            })
          }
        },
      },
    },
  },
})

export type Auth = typeof auth
export type Session = typeof auth.$Infer.Session

export { auth }
