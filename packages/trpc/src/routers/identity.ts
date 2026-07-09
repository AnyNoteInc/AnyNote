import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import { decryptSecret, encryptSecret, type EncryptedPayload } from '@repo/auth'

import { router, protectedProcedure } from '../trpc'
import { assertRole } from '../helpers/membership'
import { mapDomain } from '../helpers/map-domain'
import { createIdentitySsoPort } from '../helpers/sso-port'
import { domain as domainSvc } from '../domain'

// Identity governance (Phase 8B, spec §4): allowed domains, DNS verification,
// per-workspace SSO providers, domain auto-join. Every MANAGED procedure is
// OWNER-only — domains and providers are security-adjacent, NOT membership
// admin work (ADMIN ⇒ FORBIDDEN, pinned by tests). Member-level surface is
// `domainJoin.*` only.

type Ctx = { prisma: PrismaClient; user: { id: string; email: string } }

function assertIdentityOwner(ctx: Ctx, workspaceId: string) {
  return assertRole(ctx, workspaceId, ['OWNER'])
}

const providerTypeSchema = z.enum(['OIDC', 'OAUTH', 'SAML_RESERVED'])
const enterpriseFeatureSchema = z.enum(['SAML', 'SCIM', 'MANAGED_USERS'])
const domainNameSchema = z.string().trim().min(3).max(255)

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

// OIDC/OAUTH need the full connection up front (https issuer + client id +
// secret); SAML_RESERVED is name-only (the domain drops connection fields).
const providerCreateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    type: providerTypeSchema,
    name: z.string().trim().min(1).max(100),
    issuerUrl: z.string().trim().max(500).optional(),
    clientId: z.string().trim().min(1).max(255).optional(),
    clientSecret: z.string().min(1).max(4096).optional(),
  })
  .superRefine((val, refCtx) => {
    if (val.type === 'SAML_RESERVED') return
    if (!val.issuerUrl || !isHttpsUrl(val.issuerUrl)) {
      refCtx.addIssue({
        code: 'custom',
        path: ['issuerUrl'],
        message: 'issuerUrl обязателен и должен быть https URL',
      })
    }
    if (!val.clientId) {
      refCtx.addIssue({
        code: 'custom',
        path: ['clientId'],
        message: 'clientId обязателен для OIDC/OAuth провайдера',
      })
    }
    if (!val.clientSecret) {
      refCtx.addIssue({
        code: 'custom',
        path: ['clientSecret'],
        message: 'clientSecret обязателен для OIDC/OAuth провайдера',
      })
    }
  })

const providerUpdateSchema = z
  .object({
    workspaceId: z.string().uuid(),
    providerId: z.string().uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    issuerUrl: z.string().trim().max(500).optional(),
    clientId: z.string().trim().min(1).max(255).optional(),
    /** Omitted = keep the stored secret (write-only field semantics). */
    clientSecret: z.string().min(1).max(4096).optional(),
  })
  .superRefine((val, refCtx) => {
    if (val.issuerUrl !== undefined && !isHttpsUrl(val.issuerUrl)) {
      refCtx.addIssue({
        code: 'custom',
        path: ['issuerUrl'],
        message: 'issuerUrl должен быть https URL',
      })
    }
  })

/**
 * Lazy plaintext-secret resolver for the SSO port: a fresh input secret wins;
 * otherwise the STORED `clientSecretEnc` is read and decrypted on demand —
 * only when the port actually needs it (register/update hydration), never for
 * unregister-only flows. The plaintext lives exclusively inside this closure;
 * the domain layer only ever sees the opaque encrypted Json.
 */
function storedSecretResolver(
  prisma: PrismaClient,
  workspaceId: string,
  providerId: string,
  freshSecret?: string,
): () => Promise<string> {
  return async () => {
    if (freshSecret) return freshSecret
    const row = await prisma.workspaceAuthProvider.findFirst({
      where: { id: providerId, workspaceId },
      select: { clientSecretEnc: true },
    })
    if (!row?.clientSecretEnc) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'У провайдера нет сохранённого секрета',
      })
    }
    try {
      return decryptSecret(row.clientSecretEnc as unknown as EncryptedPayload)
    } catch {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Секрет провайдера повреждён или изменён ключ шифрования',
      })
    }
  }
}

/** For flows that can only ever `unregister` — the resolver must never fire. */
const unregisterOnlyResolver = async (): Promise<string> => {
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'SSO port: секрет недоступен в unregister-only операции',
  })
}

export const identityRouter = router({
  // ── managed: allowed email domains (auto-join surface) ─────────────────────

  allowedDomains: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() => domainSvc.identity.listAllowedDomains(input.workspaceId))
      }),

    add: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), domain: domainNameSchema }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() =>
          domainSvc.identity.addAllowedDomain({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            domain: input.domain,
          }),
        )
      }),

    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), domainId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() =>
          domainSvc.identity.removeAllowedDomain({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            domainId: input.domainId,
          }),
        )
      }),
  }),

  // ── managed: DNS-verified domains (the SSO gate) ───────────────────────────

  verifiedDomains: router({
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() => domainSvc.identity.listVerifiedDomains(input.workspaceId))
      }),

    start: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), domain: domainNameSchema }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() =>
          domainSvc.identity.startDomainVerification({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            domain: input.domain,
          }),
        )
      }),

    rotate: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), domainId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() =>
          domainSvc.identity.rotateVerificationToken({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            domainId: input.domainId,
          }),
        )
      }),

    // No resolver passed — the domain's default node:dns TXT resolver runs.
    check: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), domainId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() =>
          domainSvc.identity.checkDomainVerification({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            domainId: input.domainId,
          }),
        )
      }),

    // Bound ACTIVE providers get disabled in the same tx; their plugin rows
    // are deregistered through the port FIRST (port-before-tx, sso.md).
    remove: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), domainId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        const port = createIdentitySsoPort({
          prisma: ctx.prisma,
          resolveClientSecret: unregisterOnlyResolver,
        })
        return mapDomain(() =>
          domainSvc.identity.removeVerifiedDomain(
            {
              workspaceId: input.workspaceId,
              actorId: ctx.user.id,
              domainId: input.domainId,
            },
            port,
          ),
        )
      }),
  }),

  // ── managed: auth providers ────────────────────────────────────────────────

  providers: router({
    // The domain DTO is already secret-free (`hasClientSecret` flag only).
    list: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        return mapDomain(() => domainSvc.identity.listProviders(input.workspaceId))
      }),

    create: protectedProcedure.input(providerCreateSchema).mutation(async ({ ctx, input }) => {
      await assertIdentityOwner(ctx, input.workspaceId)
      // Encryption happens HERE (the ai-provider precedent): the domain only
      // ever stores the opaque payload and reduces it to a presence flag.
      const clientSecretEnc = input.clientSecret ? encryptSecret(input.clientSecret) : undefined
      return mapDomain(() =>
        domainSvc.identity.createProvider({
          workspaceId: input.workspaceId,
          actorId: ctx.user.id,
          type: input.type,
          name: input.name,
          issuerUrl: input.issuerUrl,
          clientId: input.clientId,
          clientSecretEnc,
        }),
      )
    }),

    update: protectedProcedure.input(providerUpdateSchema).mutation(async ({ ctx, input }) => {
      await assertIdentityOwner(ctx, input.workspaceId)
      // The port only fires for an ACTIVE registered provider (plugin-row
      // sync); its closure resolves the plaintext lazily — fresh input first,
      // stored secret otherwise (read BEFORE the domain persists, port-before-tx).
      const port = createIdentitySsoPort({
        prisma: ctx.prisma,
        resolveClientSecret: storedSecretResolver(
          ctx.prisma,
          input.workspaceId,
          input.providerId,
          input.clientSecret,
        ),
      })
      return mapDomain(() =>
        domainSvc.identity.updateProvider(
          {
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            providerId: input.providerId,
            name: input.name,
            issuerUrl: input.issuerUrl,
            clientId: input.clientId,
            // undefined = keep the stored secret (write-only semantics).
            clientSecretEnc: input.clientSecret ? encryptSecret(input.clientSecret) : undefined,
          },
          port,
        ),
      )
    }),

    activate: protectedProcedure
      .input(
        z.object({
          workspaceId: z.string().uuid(),
          providerId: z.string().uuid(),
          domainId: z.string().uuid(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        const port = createIdentitySsoPort({
          prisma: ctx.prisma,
          resolveClientSecret: storedSecretResolver(
            ctx.prisma,
            input.workspaceId,
            input.providerId,
          ),
        })
        return mapDomain(() =>
          domainSvc.identity.activateProvider(
            {
              workspaceId: input.workspaceId,
              actorId: ctx.user.id,
              providerId: input.providerId,
              domainId: input.domainId,
            },
            port,
          ),
        )
      }),

    disable: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), providerId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        const port = createIdentitySsoPort({
          prisma: ctx.prisma,
          resolveClientSecret: unregisterOnlyResolver,
        })
        return mapDomain(() =>
          domainSvc.identity.disableProvider(
            {
              workspaceId: input.workspaceId,
              actorId: ctx.user.id,
              providerId: input.providerId,
            },
            port,
          ),
        )
      }),

    delete: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), providerId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        const port = createIdentitySsoPort({
          prisma: ctx.prisma,
          resolveClientSecret: unregisterOnlyResolver,
        })
        return mapDomain(() =>
          domainSvc.identity.deleteProvider(
            {
              workspaceId: input.workspaceId,
              actorId: ctx.user.id,
              providerId: input.providerId,
            },
            port,
          ),
        )
      }),

    // Honest enterprise pre-sales (spec §7 invariant 6): the in-tx audit row
    // IS the record. The notifications catalog has no fitting event type
    // (account/collab/page/db only), the proc is OWNER-gated so the actor IS
    // the workspace owner (self-notification would be noise), and adding a
    // NotificationEventType is a schema migration outside this task — so no
    // notify.* call here, by decision.
    requestEnterprise: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid(), feature: enterpriseFeatureSchema }))
      .mutation(async ({ ctx, input }) => {
        await assertIdentityOwner(ctx, input.workspaceId)
        const result = await mapDomain(() =>
          domainSvc.identity.requestEnterpriseFeature({
            workspaceId: input.workspaceId,
            actorId: ctx.user.id,
            feature: input.feature,
          }),
        )
        return { ok: true as const, feature: result.feature, requestedAt: result.requestedAt }
      }),
  }),

  // ── member-level: domain auto-join (the prompt surfaces) ───────────────────

  domainJoin: router({
    /** Workspaces joinable via the CALLER's email domain (member/blocked excluded). */
    listAvailable: protectedProcedure.query(async ({ ctx }) => {
      return mapDomain(() =>
        domainSvc.identity.listDomainJoinableWorkspaces(ctx.user.id, ctx.user.email),
      )
    }),

    /** Explicit join only — lands a billable EDITOR member seat, never a guest. */
    join: protectedProcedure
      .input(z.object({ workspaceId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        return mapDomain(() =>
          domainSvc.identity.joinViaDomain({
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
            userEmail: ctx.user.email,
          }),
        )
      }),
  }),
})
