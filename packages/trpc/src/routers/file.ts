import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { FileStatus, Prisma, type File } from '@repo/db'
import * as domain from '@repo/domain'

import { protectedProcedure, router } from '../trpc'

const uuid = z.string().uuid()

const FileStatusSchema = z.nativeEnum(FileStatus)

export interface FileDTO extends Omit<File, 'fileSize'> {
  fileSize: string
}

const serializeFile = (file: File): FileDTO => ({
  ...file,
  fileSize: file.fileSize.toString(),
})

export const fileRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        cursor: uuid.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        status: z.array(FileStatusSchema).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const statuses = input.status ?? [FileStatus.ACTIVE]
      const rows = await ctx.prisma.file.findMany({
        where: { userId: ctx.user.id, status: { in: statuses } },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
      })
      return rows.map(serializeFile)
    }),

  listWorkspace: protectedProcedure
    .input(
      z.object({
        workspaceId: uuid,
        search: z.string().max(256).optional(),
        uploaderId: uuid.optional(),
        page: z.number().int().min(0).default(0),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
          },
        },
      })
      if (!member) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this workspace',
        })
      }

      const search = input.search?.trim() ?? ''
      const where: Prisma.FileWhereInput = {
        workspaceId: input.workspaceId,
        status: FileStatus.ACTIVE,
        ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}),
        ...(input.uploaderId ? { userId: input.uploaderId } : {}),
      }

      const [rows, total] = await Promise.all([
        ctx.prisma.file.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                image: true,
              },
            },
          },
          skip: input.page * input.pageSize,
          take: input.pageSize,
        }),
        ctx.prisma.file.count({ where }),
      ])

      return {
        items: rows.map((row) => ({
          ...serializeFile(row),
          user: row.user,
        })),
        total,
      }
    }),

  listRecent: protectedProcedure
    .input(
      z.object({
        workspaceId: uuid,
        limit: z.number().int().min(1).max(20).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
          },
        },
      })
      if (!member) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this workspace',
        })
      }

      const rows = await ctx.prisma.file.findMany({
        where: { workspaceId: input.workspaceId, status: FileStatus.ACTIVE },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
      })
      return rows.map((r) => ({ ...r, fileSize: r.fileSize.toString() }))
    }),

  workspaceUploaders: protectedProcedure
    .input(z.object({ workspaceId: uuid }))
    .query(async ({ ctx, input }) => {
      const member = await ctx.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: ctx.user.id,
          },
        },
      })
      if (!member) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this workspace',
        })
      }

      return ctx.prisma.user.findMany({
        where: { files: { some: { workspaceId: input.workspaceId, status: FileStatus.ACTIVE } } },
        select: { id: true, firstName: true, lastName: true, email: true, image: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }],
      })
    }),

  getById: protectedProcedure.input(z.object({ id: uuid })).query(async ({ ctx, input }) => {
    const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
    if (!file) throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' })
    if (file.userId !== ctx.user.id && !file.isPublic) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' })
    }
    const serialized = serializeFile(file)
    if (file.userId !== ctx.user.id) {
      // Public file viewed by non-owner: scrub sensitive fields
      return {
        ...serialized,
        userId: '',
        hash: '',
        path: '',
      }
    }
    return serialized
  }),

  delete: protectedProcedure.input(z.object({ id: uuid })).mutation(async ({ ctx, input }) => {
    try {
      const updated = await ctx.prisma.file.update({
        where: { id: input.id, userId: ctx.user.id },
        data: { status: FileStatus.DELETED },
      })
      return serializeFile(updated)
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' })
      }
      throw err
    }
  }),

  rename: protectedProcedure
    .input(z.object({ id: uuid, name: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const updated = await ctx.prisma.file.update({
          where: { id: input.id, userId: ctx.user.id },
          data: { name: input.name },
        })
        return serializeFile(updated)
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' })
        }
        throw err
      }
    }),

  setPublic: protectedProcedure
    .input(z.object({ id: uuid, isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const updated = await ctx.prisma.file.update({
          where: { id: input.id, userId: ctx.user.id },
          data: { isPublic: input.isPublic },
        })
        return serializeFile(updated)
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' })
        }
        throw err
      }
    }),

  attachToPage: protectedProcedure
    .input(z.object({ pageId: uuid, fileId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.pageId,
          deletedAt: null,
          workspace: { members: { some: { userId: ctx.user.id } } },
          AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
        },
        select: { id: true, workspaceId: true },
      })
      if (!page) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Page not accessible' })
      }
      const file = await ctx.prisma.file.findFirst({
        where: { id: input.fileId, userId: ctx.user.id },
        select: { id: true, workspaceId: true },
      })
      if (!file) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'File not found' })
      }
      if (!file.workspaceId || file.workspaceId !== page.workspaceId) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'File does not belong to this workspace',
        })
      }
      await ctx.prisma.pageFile.upsert({
        where: { pageId_fileId: { pageId: input.pageId, fileId: input.fileId } },
        create: { pageId: input.pageId, fileId: input.fileId },
        update: {},
      })
      return { ok: true as const }
    }),

  detachFromPage: protectedProcedure
    .input(z.object({ pageId: uuid, fileId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.pageId,
          workspace: { members: { some: { userId: ctx.user.id } } },
          AND: [domain.buildPageVisibilityWhere(ctx.user.id)],
        },
        select: { id: true },
      })
      if (!page) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Page not accessible' })
      }
      try {
        await ctx.prisma.pageFile.delete({
          where: { pageId_fileId: { pageId: input.pageId, fileId: input.fileId } },
        })
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return { ok: true as const }
        }
        throw err
      }
      return { ok: true as const }
    }),
})
