import { TRPCError } from "@trpc/server"
import { z } from "zod"

import { FileStatus, type File } from "@repo/db"

import { protectedProcedure, router } from "../trpc"

const uuid = z.string().uuid()

const FileStatusSchema = z.nativeEnum(FileStatus)

type FileDTO = Omit<File, "fileSize"> & { fileSize: string }

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
        orderBy: { createdAt: "desc" },
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
        cursor: uuid.optional(),
        limit: z.number().int().min(1).max(100).default(50),
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
          code: "FORBIDDEN",
          message: "Not a member of this workspace",
        })
      }
      const rows = await ctx.prisma.file.findMany({
        where: { workspaceId: input.workspaceId, status: FileStatus.ACTIVE },
        orderBy: { createdAt: "desc" },
        take: input.limit,
        cursor: input.cursor ? { id: input.cursor } : undefined,
        skip: input.cursor ? 1 : 0,
      })
      return rows.map(serializeFile)
    }),

  getById: protectedProcedure.input(z.object({ id: uuid })).query(async ({ ctx, input }) => {
    const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
    if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
    if (file.userId !== ctx.user.id && !file.isPublic) {
      throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
    }
    const serialized = serializeFile(file)
    if (file.userId !== ctx.user.id) {
      // Public file viewed by non-owner: scrub sensitive fields
      return {
        ...serialized,
        userId: "",
        hash: "",
        path: "",
      }
    }
    return serialized
  }),

  delete: protectedProcedure.input(z.object({ id: uuid })).mutation(async ({ ctx, input }) => {
    const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
    if (!file || file.userId !== ctx.user.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
    }
    const updated = await ctx.prisma.file.update({
      where: { id: input.id },
      data: { status: FileStatus.DELETED },
    })
    return serializeFile(updated)
  }),

  rename: protectedProcedure
    .input(z.object({ id: uuid, name: z.string().min(1).max(512) }))
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
      if (!file || file.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
      }
      const updated = await ctx.prisma.file.update({
        where: { id: input.id },
        data: { name: input.name },
      })
      return serializeFile(updated)
    }),

  setPublic: protectedProcedure
    .input(z.object({ id: uuid, isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const file = await ctx.prisma.file.findUnique({ where: { id: input.id } })
      if (!file || file.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "File not found" })
      }
      const updated = await ctx.prisma.file.update({
        where: { id: input.id },
        data: { isPublic: input.isPublic },
      })
      return serializeFile(updated)
    }),
})
