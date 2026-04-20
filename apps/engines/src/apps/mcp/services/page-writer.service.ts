import { Inject, Injectable } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { PageNotFoundError } from "../errors/mcp.errors.js"

export type CreatePageInput = {
  userId: string
  workspaceId: string
  parentId?: string | null
  title: string
  ownership?: "TEXT" | "SKILL" | "AGENT"
}

export type UpdatePageInput = {
  userId: string
  workspaceId: string
  pageId: string
  title?: string
  icon?: string | null
  content?: unknown
}

export type MovePageInput = {
  userId: string
  workspaceId: string
  pageId: string
  newParentId?: string | null
  prevPageId?: string | null
}

@Injectable()
export class PageWriter {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async createPage(input: CreatePageInput): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.create({
        data: {
          workspaceId: input.workspaceId,
          parentId: input.parentId ?? null,
          title: input.title,
          ownership: input.ownership ?? "TEXT",
          type: "TEXT",
          createdById: input.userId,
          updatedById: input.userId,
        },
        select: { id: true },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: page.id,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
      return page.id
    })
  }

  async updatePage(input: UpdatePageInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          title: input.title,
          icon: input.icon,
          content: input.content as never,
          updatedById: input.userId,
        },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }

  async movePage(input: MovePageInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          parentId: input.newParentId ?? null,
          prevPageId: input.prevPageId ?? null,
          updatedById: input.userId,
        },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }
}
