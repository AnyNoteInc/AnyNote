import { AsyncLocalStorage } from 'node:async_hooks'

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
import { notify } from '@repo/notifications'

type VerificationEmailContext = { skipUserCleanupOnFailure: boolean }
const verificationEmailContext = new AsyncLocalStorage<VerificationEmailContext>()

/**
 * Run a callback that triggers `sendVerificationEmail` without the default
 * sign-up-flow side effect of deleting the user on send failure. Used by the
 * resend-from-settings flow where the user already exists and shouldn't be
 * removed if SMTP is briefly down.
 */
export function withVerificationResendContext<T>(fn: () => Promise<T>): Promise<T> {
  return verificationEmailContext.run({ skipUserCleanupOnFailure: true }, fn)
}

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
      try {
        await notify.resetPassword(prisma, {
          userId: userWithName.id,
          firstName: userWithName.firstName ?? '',
          link,
          expiresAtIso,
        })
      } catch (err) {
        // better-auth stores reset tokens with identifier `reset-password:<token>`
        // (see better-auth/dist/api/routes/password.mjs). Match on that exact key.
        await prisma.verification
          .deleteMany({ where: { identifier: `reset-password:${token}` } })
          .catch(() => {})
        throw err
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFY_EXPIRES_S,
    sendVerificationEmail: async ({ user, url }) => {
      const expiresAtIso = new Date(Date.now() + VERIFY_EXPIRES_S * 1000).toISOString()
      const userWithName = user as { firstName?: string; email: string; id: string }
      try {
        await notify.verifyEmail(prisma, {
          userId: userWithName.id,
          firstName: userWithName.firstName ?? '',
          link: url,
          expiresAtIso,
        })
      } catch (err) {
        const ctx = verificationEmailContext.getStore()
        if (!ctx?.skipUserCleanupOnFailure) {
          await prisma.user.delete({ where: { id: userWithName.id } }).catch(() => {})
        }
        throw err
      }
    },
    afterEmailVerification: async (user) => {
      const userWithName = user as { firstName?: string; email: string; id: string }
      await notify.welcome(prisma, {
        userId: userWithName.id,
        firstName: userWithName.firstName ?? '',
        appUrl: `${appUrl()}/app`,
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
            await notify.welcome(prisma, {
              userId: userWithName.id,
              firstName: userWithName.firstName ?? '',
              appUrl: `${appUrl()}/app`,
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
