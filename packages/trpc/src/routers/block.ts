import { z } from "zod"
import { TRPCError } from "@trpc/server"

import type { Block } from "@repo/db"
import { Prisma } from "@repo/db"

import { router, protectedProcedure } from "../trpc"
import { BlockCreateInput } from "../schemas/block-content"

type OrderedBlock = Block & { depth: number }

function orderBlocks(blocks: Block[]): OrderedBlock[] {
  const byParent = new Map<string | null, Map<string | null, Block>>()
  for (const block of blocks) {
    const parent = block.parentBlockId
    let group = byParent.get(parent)
    if (!group) {
      group = new Map()
      byParent.set(parent, group)
    }
    group.set(block.prevBlockId, block)
  }

  const out: OrderedBlock[] = []
  const walk = (parent: string | null, depth: number): void => {
    const group = byParent.get(parent)
    if (!group) return
    let cursor: string | null = null
    while (group.has(cursor)) {
      const nextBlock: Block = group.get(cursor)!
      out.push(Object.assign(nextBlock, { depth }))
      walk(nextBlock.id, depth + 1)
      cursor = nextBlock.id
    }
  }
  walk(null, 0)
  return out
}

async function assertPageAccess(
  ctx: { prisma: typeof import("@repo/db").default; user: { id: string } },
  pageId: string,
) {
  const page = await ctx.prisma.page.findFirst({
    where: { id: pageId, workspace: { members: { some: { userId: ctx.user.id } } } },
    select: { id: true },
  })
  if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
}

export const blockRouter = router({
  listByPage: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      const rows = await ctx.prisma.block.findMany({
        where: { pageId: input.pageId, archivedAt: null },
      })
      return orderBlocks(rows)
    }),

  create: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        parentBlockId: z.string().uuid().nullish(),
        afterBlockId: z.string().uuid().nullish(),
        block: BlockCreateInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return ctx.prisma.$transaction(async (tx) => {
        const parentBlockId = input.parentBlockId ?? null
        const after = input.afterBlockId
          ? await tx.block.findFirst({
              where: { id: input.afterBlockId, pageId: input.pageId, parentBlockId },
            })
          : null
        if (input.afterBlockId && !after) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "afterBlockId not in the same sibling group" })
        }

        const exNext = await tx.block.findFirst({
          where: { pageId: input.pageId, parentBlockId, prevBlockId: after?.id ?? null },
        })

        const created = await tx.block.create({
          data: {
            pageId: input.pageId,
            parentBlockId,
            prevBlockId: after?.id ?? null,
            type: input.block.type,
            content: input.block.content,
            createdById: ctx.user.id,
          },
        })

        if (exNext) {
          await tx.block.update({
            where: { id: exNext.id },
            data: { prevBlockId: created.id },
          })
        }

        return created
      })
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        content: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const block = await ctx.prisma.block.findFirst({
        where: { id: input.id, page: { workspace: { members: { some: { userId: ctx.user.id } } } } },
      })
      if (!block) throw new TRPCError({ code: "NOT_FOUND" })
      return ctx.prisma.block.update({
        where: { id: input.id },
        data: { content: input.content as Prisma.InputJsonValue, updatedById: ctx.user.id },
      })
    }),

  move: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        newParentBlockId: z.string().uuid().nullable(),
        newAfterBlockId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const block = await tx.block.findFirst({
          where: { id: input.id, page: { workspace: { members: { some: { userId: ctx.user.id } } } } },
        })
        if (!block) throw new TRPCError({ code: "NOT_FOUND" })

        const oldNext = await tx.block.findFirst({
          where: { pageId: block.pageId, parentBlockId: block.parentBlockId, prevBlockId: block.id },
        })
        if (oldNext) {
          await tx.block.update({
            where: { id: oldNext.id },
            data: { prevBlockId: block.prevBlockId },
          })
        }

        const newPrev = input.newAfterBlockId
          ? await tx.block.findFirst({
              where: { id: input.newAfterBlockId, pageId: block.pageId, parentBlockId: input.newParentBlockId },
            })
          : null
        const newNext = await tx.block.findFirst({
          where: {
            pageId: block.pageId,
            parentBlockId: input.newParentBlockId,
            prevBlockId: newPrev?.id ?? null,
          },
        })

        await tx.block.update({
          where: { id: block.id },
          data: { parentBlockId: input.newParentBlockId, prevBlockId: newPrev?.id ?? null },
        })
        if (newNext && newNext.id !== block.id) {
          await tx.block.update({
            where: { id: newNext.id },
            data: { prevBlockId: block.id },
          })
        }

        return tx.block.findUnique({ where: { id: block.id } })
      })
    }),

  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.$transaction(async (tx) => {
        const block = await tx.block.findFirst({
          where: { id: input.id, page: { workspace: { members: { some: { userId: ctx.user.id } } } } },
        })
        if (!block) throw new TRPCError({ code: "NOT_FOUND" })
        const next = await tx.block.findFirst({
          where: { pageId: block.pageId, parentBlockId: block.parentBlockId, prevBlockId: block.id },
        })
        if (next) {
          await tx.block.update({
            where: { id: next.id },
            data: { prevBlockId: block.prevBlockId },
          })
        }
        return tx.block.update({
          where: { id: block.id },
          data: { archivedAt: new Date(), prevBlockId: null },
        })
      })
    }),
})
