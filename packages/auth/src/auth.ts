import { betterAuth } from "better-auth"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { magicLink, bearer, jwt, deviceAuthorization, lastLoginMethod } from "better-auth/plugins"
import { nextCookies } from "better-auth/next-js"

import { prisma, SubscriptionStatus } from "@repo/db"

const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "sendResetPassword is not wired to a real transport. Configure email delivery before enabling password reset in production.",
        )
      }
      console.info(`Password reset link for ${user.email}: ${url}`)
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
  },
  user: {
    additionalFields: {
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
    },
  },
  socialProviders: {},
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (process.env.NODE_ENV !== "production") {
          console.info(`Magic link for ${email}: ${url}`)
        }
      },
    }),
    deviceAuthorization({
      expiresIn: "3min",
      interval: "5s",
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
          const personalPlan = await prisma.plan.findUniqueOrThrow({ where: { slug: "personal" } })
          await prisma.subscription.create({
            data: {
              userId: user.id,
              planId: personalPlan.id,
              status: SubscriptionStatus.ACTIVE,
              billingPeriod: "MONTHLY",
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
