import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { BadRequestException, HttpException } from '@nestjs/common'
import { forbidden } from '@repo/domain'
import type { PrismaClient } from '@repo/db'

import { PageNotFoundError } from '../errors/mcp.errors.js'
import { KanbanGateway, mapDomainError } from './kanban-gateway.service.js'

describe('mapDomainError', () => {
  it('maps DomainError → HttpException with its status', () => {
    const mapped = mapDomainError(forbidden('nope'))
    expect(mapped).toBeInstanceOf(HttpException)
    expect((mapped as HttpException).getStatus()).toBe(403)
  })
  it('passes non-domain errors through', () => {
    const e = new Error('x')
    expect(mapDomainError(e)).toBe(e)
  })
})

describe('KanbanGateway', () => {
  const pageFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const pageFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const columnFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const sprintFindFirst = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const sprintFindMany = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = {
    page: { findFirst: pageFindFirst, findMany: pageFindMany },
    kanbanColumn: { findMany: columnFindMany },
    sprint: { findFirst: sprintFindFirst, findMany: sprintFindMany },
  } as unknown as PrismaClient
  let gw: KanbanGateway

  beforeEach(() => {
    jest.clearAllMocks()
    gw = new KanbanGateway(prisma)
  })

  it('assertBoard accepts a KANBAN page in the workspace', async () => {
    pageFindFirst.mockResolvedValue({ id: 'b1' })
    await expect(gw.assertBoard('u1', 'w1', 'b1')).resolves.toEqual({ id: 'b1' })
  })
  it('assertBoard throws PageNotFoundError otherwise', async () => {
    pageFindFirst.mockResolvedValue(null)
    await expect(gw.assertBoard('u1', 'w1', 'b1')).rejects.toBeInstanceOf(PageNotFoundError)
  })
  it('resolveBoardPageId auto-selects the single board', async () => {
    pageFindMany.mockResolvedValue([{ id: 'only', title: 'Dev' }])
    expect(await gw.resolveBoardPageId('u1', 'w1', undefined)).toBe('only')
  })
  it('resolveBoardPageId errors when multiple boards and none given', async () => {
    pageFindMany.mockResolvedValue([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ])
    await expect(gw.resolveBoardPageId('u1', 'w1', undefined)).rejects.toBeInstanceOf(BadRequestException)
  })
  it('resolveColumnByStatus matches case-insensitively, else throws', async () => {
    columnFindMany.mockResolvedValue([{ id: 'c2', title: 'In Progress', kind: 'ACTIVE' }])
    expect(await gw.resolveColumnByStatus('b1', 'in progress')).toBe('c2')
    await expect(gw.resolveColumnByStatus('b1', 'Nope')).rejects.toBeInstanceOf(BadRequestException)
  })
  it('resolveSprintTarget: backlog→null, current→active id', async () => {
    sprintFindFirst.mockResolvedValue({ id: 's-active' })
    expect(await gw.resolveSprintTarget('b1', 'backlog')).toBeNull()
    expect(await gw.resolveSprintTarget('b1', 'current')).toBe('s-active')
  })
})
