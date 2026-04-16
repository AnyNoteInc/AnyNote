import { z } from "zod"
import { TRPCError } from "@trpc/server"
import { PageType, type PrismaClient } from "@repo/db"

import { router, protectedProcedure } from "../trpc"

// ── Helpers ──────────────────────────────────────────────────────────────────

async function assertWorkspaceMember(
  ctx: { prisma: PrismaClient; user: { id: string } },
  workspaceId: string,
) {
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
  })
  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Вы не являетесь участником воркспейса" })
  }
  return member
}

async function assertPageAccess(
  ctx: { prisma: PrismaClient; user: { id: string } },
  pageId: string,
) {
  const page = await ctx.prisma.page.findFirst({
    where: {
      id: pageId,
      workspace: { members: { some: { userId: ctx.user.id } } },
    },
  })
  if (!page) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
  }
  return page
}

async function assertPageOwnership(
  ctx: { prisma: PrismaClient; user: { id: string } },
  pageId: string,
  workspaceId: string,
) {
  const [page, member] = await Promise.all([
    ctx.prisma.page.findFirst({
      where: {
        id: pageId,
        workspaceId,
        workspace: { members: { some: { userId: ctx.user.id } } },
      },
    }),
    ctx.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: ctx.user.id } },
    }),
  ])
  if (!page) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
  }
  if (!member) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Вы не являетесь участником воркспейса" })
  }
  const isOwner = member.role === "OWNER"
  const isCreator = page.createdById === ctx.user.id
  if (!isOwner && !isCreator) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Недостаточно прав" })
  }
  return page
}

// ── Router ───────────────────────────────────────────────────────────────────

export const pageRouter = router({
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.id,
          workspace: { members: { some: { userId: ctx.user.id } } },
        },
      })
      if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
      return page
    }),

  listByWorkspace: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          archived: false,
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          icon: true,
          parentId: true,
          prevPageId: true,
          createdById: true,
          createdAt: true,
        },
      })
    }),

  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        parentId: z.string().uuid().nullable(),
        title: z.string().optional(),
        icon: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)

      // If parent is a page, verify it exists and belongs to same workspace
      if (input.parentId) {
        const parentPage = await ctx.prisma.page.findFirst({
          where: { id: input.parentId, workspaceId: input.workspaceId, deletedAt: null },
        })
        if (!parentPage) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Родительская страница не найдена",
          })
        }
      }

      return ctx.prisma.$transaction(async (tx) => {
        const newPage = await tx.page.create({
          data: {
            workspaceId: input.workspaceId,
            parentId: input.parentId,
            title: input.title ?? null,
            icon: input.icon ?? null,
            prevPageId: null,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        })

        // Insert at start of linked list: find current first sibling and point it to newPage
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: input.workspaceId,
            parentId: input.parentId,
            prevPageId: null,
            id: { not: newPage.id },
            deletedAt: null,
          },
        })
        if (existingFirst) {
          await tx.page.update({
            where: { id: existingFirst.id },
            data: { prevPageId: newPage.id },
          })
        }

        return newPage
      })
    }),

  rename: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
        title: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageOwnership(ctx, input.id, input.workspaceId)
      return ctx.prisma.page.update({
        where: { id: input.id },
        data: { title: input.title, updatedById: ctx.user.id },
      })
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
        title: z.string().optional(),
        icon: z.string().nullable().optional(),
        type: z.nativeEnum(PageType).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageOwnership(ctx, input.id, input.workspaceId)
      const data: {
        title?: string
        icon?: string | null
        type?: PageType
        updatedById: string
      } = { updatedById: ctx.user.id }
      if (input.title !== undefined) data.title = input.title
      if (input.icon !== undefined) data.icon = input.icon
      if (input.type !== undefined) data.type = input.type
      return ctx.prisma.page.update({
        where: { id: input.id },
        data,
      })
    }),

  softDelete: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageOwnership(ctx, input.id, input.workspaceId)
      const now = new Date()

      return ctx.prisma.$transaction(async (tx) => {
        // Remove page from linked list (detach first to avoid unique constraint)
        const nextSibling = await tx.page.findFirst({
          where: { prevPageId: page.id, deletedAt: null },
        })
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: null },
          })
        }

        // Soft-delete this page
        await tx.page.update({
          where: { id: page.id },
          data: { deletedAt: now, prevPageId: null, updatedById: ctx.user.id },
        })

        // Reattach next sibling to previous
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: page.prevPageId },
          })
        }

        // Soft-delete all descendants recursively
        // Use a loop to walk the tree breadth-first
        let parentIds: string[] = [page.id]
        while (parentIds.length > 0) {
          const children = await tx.page.findMany({
            where: {
              parentId: { in: parentIds },
              deletedAt: null,
            },
            select: { id: true },
          })
          if (children.length === 0) break
          const childIds = children.map((c) => c.id)
          await tx.page.updateMany({
            where: { id: { in: childIds } },
            data: { deletedAt: now, updatedById: ctx.user.id },
          })
          parentIds = childIds
        }

        return { id: page.id }
      })
    }),

  restore: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageOwnership(ctx, input.id, input.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        const page = await tx.page.findFirst({
          where: { id: input.id, workspaceId: input.workspaceId },
        })
        if (!page || !page.deletedAt) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена в корзине" })
        }

        // Determine restore location: if parent is deleted, move to workspace root
        let restoreParentId = page.parentId

        if (page.parentId) {
          const parentPage = await tx.page.findFirst({
            where: { id: page.parentId, deletedAt: null },
          })
          if (!parentPage) {
            // Parent is still deleted — move to workspace root
            restoreParentId = null
          }
        }

        // Restore the page
        await tx.page.update({
          where: { id: page.id },
          data: {
            deletedAt: null,
            parentId: restoreParentId,
            prevPageId: null,
            updatedById: ctx.user.id,
          },
        })

        // Insert at start of linked list
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: input.workspaceId,
            parentId: restoreParentId,
            prevPageId: null,
            id: { not: page.id },
            deletedAt: null,
          },
        })
        if (existingFirst) {
          await tx.page.update({
            where: { id: existingFirst.id },
            data: { prevPageId: page.id },
          })
        }

        // Restore all descendants recursively
        let parentIds: string[] = [page.id]
        while (parentIds.length > 0) {
          const children = await tx.page.findMany({
            where: {
              parentId: { in: parentIds },
              deletedAt: { not: null },
            },
            select: { id: true },
          })
          if (children.length === 0) break
          const childIds = children.map((c) => c.id)
          await tx.page.updateMany({
            where: { id: { in: childIds } },
            data: { deletedAt: null, updatedById: ctx.user.id },
          })
          parentIds = childIds
        }

        return { id: page.id }
      })
    }),

  hardDelete: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        workspaceId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertPageOwnership(ctx, input.id, input.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        const page = await tx.page.findFirst({
          where: { id: input.id, workspaceId: input.workspaceId },
        })
        if (!page) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
        }

        // Remove from linked list if still linked
        const nextSibling = await tx.page.findFirst({
          where: { prevPageId: page.id },
        })
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: page.prevPageId },
          })
        }

        // Delete the page (cascade handles related rows)
        await tx.page.delete({ where: { id: page.id } })

        return { id: page.id }
      })
    }),

  listTrashed: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      return ctx.prisma.page.findMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: { not: null },
        },
        orderBy: { deletedAt: "desc" },
        select: {
          id: true,
          title: true,
          icon: true,
          parentId: true,
          deletedAt: true,
          createdById: true,
          createdAt: true,
        },
      })
    }),

  emptyTrash: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const member = await assertWorkspaceMember(ctx, input.workspaceId)
      if (member.role !== "OWNER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Только владелец может очистить корзину" })
      }
      const deleted = await ctx.prisma.page.deleteMany({
        where: {
          workspaceId: input.workspaceId,
          deletedAt: { not: null },
        },
      })
      return { count: deleted.count }
    }),

  move: protectedProcedure
    .input(
      z.object({
        pageId: z.string().uuid(),
        newParentId: z.string().uuid().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)

      // Check ownership: must be creator or workspace OWNER
      await assertPageOwnership(ctx, input.pageId, page.workspaceId)

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Remove from old linked-list (detach first to avoid unique constraint)
        const nextSibling = await tx.page.findFirst({
          where: { prevPageId: page.id, deletedAt: null },
        })
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: null },
          })
        }

        // 2. Prevent moving into own descendant
        if (input.newParentId) {
          let currentId: string | null = input.newParentId
          while (currentId) {
            if (currentId === input.pageId) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Невозможно переместить страницу в собственного потомка",
              })
            }
            const ancestor: { parentId: string | null } | null = await tx.page.findFirst({
              where: { id: currentId, deletedAt: null },
              select: { parentId: true },
            })
            currentId = ancestor?.parentId ?? null
          }
        }

        // 3. Set new parentId
        await tx.page.update({
          where: { id: page.id },
          data: {
            parentId: input.newParentId,
            prevPageId: null,
            updatedById: ctx.user.id,
          },
        })

        // Reattach next sibling to previous in old list
        if (nextSibling) {
          await tx.page.update({
            where: { id: nextSibling.id },
            data: { prevPageId: page.prevPageId },
          })
        }

        // 4. Insert at head of new parent's linked-list
        const existingFirst = await tx.page.findFirst({
          where: {
            workspaceId: page.workspaceId,
            parentId: input.newParentId,
            prevPageId: null,
            id: { not: page.id },
            deletedAt: null,
          },
        })
        if (existingFirst) {
          await tx.page.update({
            where: { id: existingFirst.id },
            data: { prevPageId: page.id },
          })
        }

        return { id: page.id }
      })
    }),

  duplicate: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const page = await assertPageAccess(ctx, input.pageId)

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Detach old next sibling first (prevPageId is unique)
        const oldNext = await tx.page.findFirst({
          where: { prevPageId: page.id, deletedAt: null },
        })
        if (oldNext) {
          await tx.page.update({
            where: { id: oldNext.id },
            data: { prevPageId: null },
          })
        }

        // 2. Create copy with same parent, inserted after original
        const copy = await tx.page.create({
          data: {
            workspaceId: page.workspaceId,
            parentId: page.parentId,
            title: `${page.title ?? ""} (копия)`.trim(),
            icon: page.icon,
            prevPageId: page.id,
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
          },
        })

        // 3. Reattach old next sibling to point to copy
        if (oldNext) {
          await tx.page.update({
            where: { id: oldNext.id },
            data: { prevPageId: copy.id },
          })
        }

        return copy
      })
    }),

  addFavorite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return ctx.prisma.favoritePage.upsert({
        where: { userId_pageId: { userId: ctx.user.id, pageId: input.pageId } },
        create: { userId: ctx.user.id, pageId: input.pageId },
        update: {},
      })
    }),

  removeFavorite: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      await ctx.prisma.favoritePage.deleteMany({
        where: { userId: ctx.user.id, pageId: input.pageId },
      })
      return { pageId: input.pageId }
    }),

  listFavorites: protectedProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      const favorites = await ctx.prisma.favoritePage.findMany({
        where: {
          userId: ctx.user.id,
          page: {
            workspaceId: input.workspaceId,
            deletedAt: null,
          },
        },
        include: {
          page: {
            select: {
              id: true,
              title: true,
              icon: true,
              parentId: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      })
      return favorites.map((f) => f.page)
    }),
})
