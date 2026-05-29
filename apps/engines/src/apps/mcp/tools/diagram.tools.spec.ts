import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import type { PrismaClient } from '@repo/db'

import type { AuthedRequest } from '../../api/auth/auth-context.js'
import { DiagramValidationError } from '../errors/mcp.errors.js'
import { DiagramValidatorService } from '../services/diagram-validator.service.js'
import type { PageWriter } from '../services/page-writer.service.js'
import { DiagramTools } from './diagram.tools.js'

describe('DiagramTools.createDiagramPage', () => {
  const memberFindUnique = jest.fn<(...a: unknown[]) => Promise<unknown>>()
  const prisma = { workspaceMember: { findUnique: memberFindUnique } } as unknown as PrismaClient
  const createDiagramPage = jest.fn<(...a: unknown[]) => Promise<string>>()
  const writer = { createDiagramPage } as unknown as PageWriter
  const validator = new DiagramValidatorService()
  const req = { headers: {}, auth: { userId: 'u1', source: 'api-key' as const } } as AuthedRequest
  let tools: DiagramTools

  beforeEach(() => {
    jest.clearAllMocks()
    memberFindUnique.mockResolvedValue({ workspaceId: 'w1' })
    tools = new DiagramTools(prisma, writer, validator)
  })

  it('validates and creates a diagram page', async () => {
    createDiagramPage.mockResolvedValue('p1')
    const out = await tools.createDiagramPage(
      { workspaceId: 'w1', kind: 'MERMAID', source: 'graph TD; A-->B', title: 'D' },
      {} as never,
      req,
    )
    expect(out).toEqual({ pageId: 'p1', url: '/workspaces/w1/pages/p1' })
  })

  it('rejects invalid source before creating', async () => {
    await expect(
      tools.createDiagramPage({ workspaceId: 'w1', kind: 'MERMAID', source: 'nope', title: 'D' }, {} as never, req),
    ).rejects.toBeInstanceOf(DiagramValidationError)
    expect(createDiagramPage).not.toHaveBeenCalled()
  })

  it('rejects a non-member', async () => {
    memberFindUnique.mockResolvedValue(null)
    await expect(
      tools.createDiagramPage({ workspaceId: 'w1', kind: 'MERMAID', source: 'graph TD; A-->B', title: 'D' }, {} as never, req),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
