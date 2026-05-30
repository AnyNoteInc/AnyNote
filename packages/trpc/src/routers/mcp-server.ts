import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import { encryptSecret, decryptSecret, type EncryptedPayload } from '@repo/auth'

import { router, protectedProcedure } from '../trpc'
import { getWorkspaceFeatures } from '../helpers/plan'
import { validateMcp } from '../helpers/agents-validate'

const transportSchema = z.enum(['HTTP_JSONRPC', 'SSE', 'STREAMABLE_HTTP'])

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
  const copy = { ...row } as T & { headers?: unknown }
  delete copy.headers
  return copy
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
      const features = await getWorkspaceFeatures(input.workspaceId)
      if (!features.customMcpEnabled) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'CUSTOM_MCP_NOT_IN_PLAN' })
      }
      const ping = await validateMcp(
        { url: input.url, transport: input.transport, headers: input.headers, verify: input.verifyTls },
        { userId: ctx.user.id, workspaceId: input.workspaceId },
      )
      if (!ping.ok) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться к MCP: ${ping.error}` })
      }
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
      return { ...stripHeaders(row), tools: ping.tools }
    }),

  update: protectedProcedure
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      await assertRole(ctx, input.workspaceId, OWNERS)
      const existing = await ctx.prisma.workspaceMcpServer.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId },
      })
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })
      if (
        input.url !== undefined ||
        input.transport !== undefined ||
        input.headers !== undefined ||
        input.verifyTls !== undefined
      ) {
        const features = await getWorkspaceFeatures(input.workspaceId)
        if (!features.customMcpEnabled) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'CUSTOM_MCP_NOT_IN_PLAN' })
        }
        let headers: Record<string, string>
        if (input.headers !== undefined) {
          headers = input.headers
        } else {
          try {
            headers = decryptMcpHeaders(existing.headers)
          } catch {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'Заголовки MCP-сервера повреждены или изменён ключ шифрования',
            })
          }
        }
        const ping = await validateMcp(
          {
            url: input.url ?? existing.url,
            transport: input.transport ?? existing.transport,
            headers,
            verify: input.verifyTls ?? existing.verifyTls,
          },
          { userId: ctx.user.id, workspaceId: input.workspaceId },
        )
        if (!ping.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Не удалось подключиться к MCP: ${ping.error}` })
        }
      }
      const data: Record<string, unknown> = {}
      if (input.name !== undefined) data.name = input.name
      if (input.description !== undefined) data.description = input.description
      if (input.url !== undefined) data.url = input.url
      if (input.transport !== undefined) data.transport = input.transport
      if (input.toolsAllowlist !== undefined) data.toolsAllowlist = input.toolsAllowlist
      if (input.verifyTls !== undefined) data.verifyTls = input.verifyTls
      if (input.enabled !== undefined) data.enabled = input.enabled
      if (input.headers !== undefined) {
        data.headers = encryptSecret(JSON.stringify(input.headers)) as object
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
      const existing = await ctx.prisma.workspaceMcpServer.findFirst({
        where: { id: input.id, workspaceId: input.workspaceId },
      })
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' })
      await ctx.prisma.workspaceMcpServer.delete({ where: { id: input.id } })
      return { ok: true as const }
    }),
})

export type DecryptedHeaders = Record<string, string>

export function decryptMcpHeaders(stored: unknown): DecryptedHeaders {
  const payload = stored as EncryptedPayload
  return JSON.parse(decryptSecret(payload))
}
