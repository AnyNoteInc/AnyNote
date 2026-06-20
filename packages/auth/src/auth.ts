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
import { APIError } from 'better-auth/api'
import { sso } from '@better-auth/sso'

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

/**
 * Authoritative public origin for links baked into transactional emails.
 *
 * `BETTER_AUTH_URL` is the source of truth: it is a server-side runtime var
 * (read fresh from the rendered `.env` in prod), whereas `NEXT_PUBLIC_BASE_URL`
 * is inlined at BUILD time and behind a reverse proxy better-auth would
 * otherwise derive the request origin as `localhost:3000`. Prefer
 * `BETTER_AUTH_URL`, keep `NEXT_PUBLIC_BASE_URL` as a fallback, then localhost
 * for dev. Trailing slashes are trimmed so `${appUrl()}/path` never doubles.
 */
function appUrl(): string {
  // An empty/whitespace env var is treated as unset (it would otherwise win
  // the `??` chain and yield a broken `/path`-only link).
  const pick = (v: string | undefined): string | undefined => v?.trim() || undefined
  const raw =
    pick(process.env.BETTER_AUTH_URL) ??
    pick(process.env.NEXT_PUBLIC_BASE_URL) ??
    'http://localhost:3000'
  return raw.replace(/\/+$/, '')
}

/**
 * `firstName`/`lastName` are REQUIRED additionalFields (NOT NULL in Postgres),
 * but SSO JIT user creation only supplies `name` (the @better-auth/sso
 * callback passes `{ id, email, name, image, emailVerified }` into
 * `createOAuthUser` — mapped extraFields are NOT forwarded). This pure helper
 * derives the missing parts from `name`, mirroring the Google
 * `mapProfileToUser` fallback (auth.ts socialProviders.google). It is a no-op
 * for email/password sign-ups and Google OAuth, which always provide both
 * fields. Exported for unit tests; wired as `databaseHooks.user.create.before`.
 */
export function withDerivedNameParts<T extends Record<string, unknown>>(
  data: T,
): T & { firstName: string; lastName: string } {
  const first = typeof data.firstName === 'string' ? data.firstName : undefined
  const last = typeof data.lastName === 'string' ? data.lastName : undefined
  if (first !== undefined && last !== undefined) {
    return data as T & { firstName: string; lastName: string }
  }
  const parts = (typeof data.name === 'string' ? data.name.trim() : '').split(/\s+/).filter(Boolean)
  return {
    ...data,
    firstName: first ?? parts[0] ?? '',
    lastName: last ?? parts.slice(1).join(' '),
  }
}

/**
 * INSTANCE-level sign-up restriction (spec §5, Phase 8B) — distinct from
 * per-workspace allowed domains. `envValue` is `RESTRICT_SIGNUP_EMAIL_DOMAINS`:
 * a comma-separated, case-insensitive list of email domains (a leading `@` per
 * entry is tolerated). Unset/empty ⇒ no restriction. The match is EXACT — a
 * subdomain must be listed explicitly. Pure and exported for unit tests; wired
 * into `databaseHooks.user.create.before`, so it covers email/password, social
 * OAuth, and SSO JIT creation alike.
 */
export function isSignupEmailAllowed(email: string, envValue: string | null | undefined): boolean {
  const allowed = (envValue ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/^@/, '').toLowerCase())
    .filter((entry) => entry.length > 0)
  if (allowed.length === 0) return true
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase()
  return domain.length > 0 && allowed.includes(domain)
}

const auth = betterAuth({
  // Pin the public origin so the verification/reset links better-auth builds
  // itself (the `url` it passes to sendVerificationEmail) use the configured
  // domain instead of the request origin, which resolves to localhost:3000
  // behind the Docker reverse proxy. Same authoritative value as appUrl().
  baseURL: appUrl(),
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
    // Runtime per-workspace OIDC SSO (Phase 8B). Contract in src/sso.md:
    // providersLimit: 0 disables the public /sso/register endpoint entirely —
    // provider rows in `sso_providers` are written server-side in lock-step
    // with WorkspaceAuthProvider (the workspace-scoped source of truth).
    // domainVerification.enabled gates sign-in on the row's domainVerified
    // flag, which we only set after OUR workspace DNS verification passes.
    sso({
      providersLimit: 0,
      domainVerification: { enabled: true },
    }),
  ],
  session: {
    storeSessionInDatabase: true,
  },
  experimental: { joins: true },
  databaseHooks: {
    user: {
      create: {
        // better-auth takes exactly ONE before hook — the sign-up restriction
        // and the name-part derivation are composed here, restriction first
        // (a rejected creation must not reach any later step).
        before: async (user) => {
          const data = user as unknown as Record<string, unknown>
          const email = typeof data.email === 'string' ? data.email : ''
          if (!isSignupEmailAllowed(email, process.env.RESTRICT_SIGNUP_EMAIL_DOMAINS)) {
            throw new APIError('FORBIDDEN', {
              message: 'Регистрация ограничена доменами организации',
            })
          }
          return { data: withDerivedNameParts(data) }
        },
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
