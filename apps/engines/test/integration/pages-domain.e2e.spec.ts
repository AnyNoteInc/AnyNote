import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { prisma } from '@repo/db'

import { PageWriter } from '../../src/apps/mcp/services/page-writer.service.js'

/**
 * Proves the engines write path runs end-to-end against a real Postgres:
 *   PageWriter.createPage → @repo/domain → Prisma → DB.
 * This is the only layer that exercises domain.createPage against a live database —
 * unit suites mock Prisma. Requires `docker compose up -d`.
 *
 * Gap-fix validated: engines-created pages now land IN the linked list (have a position)
 * AND a page.upserted outbox row is enqueued.
 */
describe('Pages engines → @repo/domain → DB (integration)', () => {
  const writer = new PageWriter(prisma)

  let workspaceId: string
  let userId: string

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: 'pages-domain-int' } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: {
        name: 'Page User',
        firstName: 'P',
        lastName: 'U',
        email: `page-${workspaceId}@e.com`,
        emailVerified: true,
      },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: 'EDITOR' } })
  })

  afterEach(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('createPage positions the second page after the first (linked list) and enqueues page.upserted', async () => {
    const firstId = await writer.createPage({
      userId,
      workspaceId,
      parentId: null,
      title: 'First',
    })
    const secondId = await writer.createPage({
      userId,
      workspaceId,
      parentId: null,
      title: 'Second',
    })

    expect(typeof firstId).toBe('string')
    expect(typeof secondId).toBe('string')

    const first = await prisma.page.findUniqueOrThrow({ where: { id: firstId } })
    const second = await prisma.page.findUniqueOrThrow({ where: { id: secondId } })

    // The first page is the head (no predecessor). The second page must be positioned
    // in the list — its prevPageId points at the first (the prior tail). This is the gap-fix:
    // before delegation, engines-created pages had prevPageId == null (unordered).
    expect(first.prevPageId).toBeNull()
    expect(second.prevPageId).toBe(firstId)

    // A page.upserted outbox row exists for the created page.
    const outbox = await prisma.outboxEvent.findMany({
      where: { eventType: 'page.upserted', aggregateType: 'page', aggregateId: secondId },
    })
    expect(outbox.length).toBeGreaterThanOrEqual(1)
  })
})
