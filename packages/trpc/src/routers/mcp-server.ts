import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import { encryptSecret, decryptSecret, type EncryptedPayload } from '@repo/auth'

import { router, protectedProcedure } from '../trpc'

const transportSchema = z.enum(['HTTP_JSONRPC', 'SSE'])

const createInput = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  url: z.string().url(),
  transport: transportSchema.default('HTTP_JSONRPC'),
  headers: z.record(z.string(), z.string()).default({}),
  toolsAllowlist: z.array(z.string()).default([]),
  verifyTls: z.boolean().default(true),
})

const updateInput = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).optional(),
  url: z.string().url().optional(),
  transport: transportSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  toolsAllowlist: z.array(z.string()).optional(),
  verifyTls: z.boolean().optional(),
  enabled: z.boolean().optional(),
})

type RoleAllowed = 'OWNER' | 'ADMIN' | 'EDITOR' | 'COMMENTER' | 'VIEWER' | 'GUEST'

async function assertRole(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
  allowed: RoleAllowed[],
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member || !allowed.includes(member.role as RoleAllowed)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Недостаточно прав' })
  }
  return member
}

function stripHeaders<T extends { headers: unknown }>(row: T): Omit<T, 'headers'> {
  const { headers: _omit, ...rest } = row
  return rest
}

const READERS: RoleAllowed[] = ['OWNER', 'ADMIN', 'EDITOR', 'COMMENTER', 'VIEWER']
const OWNERS: RoleAllowed[] = ['OWNER']

export const mcpServerRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, READERS)
      const rows = await ctx.prisma.workspaceMcpServer.findMany({
        where: { workspaceId: input.workspaceId },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map(stripHeaders)
    }),

  create: protectedProcedure
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, OWNERS)
      const encrypted = encryptSecret(JSON.stringify(input.headers))
      const row = await ctx.prisma.workspaceMcpServer.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.name,
          description: input.description,
          url: input.url,
          transport: input.transport,
          headers: encrypted as unknown as object,
          toolsAllowlist: input.toolsAllowlist,
          verifyTls: input.verifyTls,
          createdById: ctx.user.id,
        },
      })
      return stripHeaders(row)
    }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, OWNERS)
      const data: Record<string, unknown> = {}
      if (input.name !== undefined) data.name = input.name
      if (input.description !== undefined) data.description = input.description
      if (input.url !== undefined) data.url = input.url
      if (input.transport !== undefined) data.transport = input.transport
      if (input.toolsAllowlist !== undefined) data.toolsAllowlist = input.toolsAllowlist
      if (input.verifyTls !== undefined) data.verifyTls = input.verifyTls
      if (input.enabled !== undefined) data.enabled = input.enabled
      if (input.headers !== undefined) {
        data.headers = encryptSecret(JSON.stringify(input.headers)) as unknown as object
      }
      const row = await ctx.prisma.workspaceMcpServer.update({
        where: { id: input.id },
        data,
      })
      return stripHeaders(row)
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, OWNERS)
      await ctx.prisma.workspaceMcpServer.delete({ where: { id: input.id } })
      return { ok: true as const }
    }),
})

export type DecryptedHeaders = Record<string, string>

export function decryptMcpHeaders(stored: unknown): DecryptedHeaders {
  const payload = stored as EncryptedPayload
  return JSON.parse(decryptSecret(payload))
}
