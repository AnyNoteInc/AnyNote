import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

vi.mock('@repo/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/auth')>()
  return {
    ...actual,
    getUserFromRequest: vi.fn(),
  }
})

vi.mock('@repo/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@repo/db')>()
  return { ...actual, prisma: {} }
})

import type { PrismaClient } from '@repo/db'
import { mcpServerRouter } from '../src/routers/mcp-server'
import { createCallerFactory } from '../src/trpc'

beforeAll(() => {
  process.env.SECRETS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
})

const USER_ID = '22222222-2222-2222-2222-222222222222'
const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111'

function baseContext(prisma: PrismaClient) {
  return {
    prisma,
    user: { id: USER_ID },
    headers: new Headers(),
    resHeaders: new Headers(),
    yookassa: {},
    returnUrlBase: 'http://localhost:3000',
  }
}

function ownerMember() {
  return { role: 'OWNER', userId: USER_ID, workspaceId: WORKSPACE_ID }
}

describe('mcpServer.create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('encrypts headers at rest and returns a row without them', async () => {
    let storedHeadersJson: string | null = null
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: {
        create: vi.fn(async ({ data }: any) => {
          storedHeadersJson = JSON.stringify(data.headers)
          return {
            id: 'srv-1',
            workspaceId: data.workspaceId,
            name: data.name,
            description: null,
            url: data.url,
            transport: data.transport,
            headers: data.headers,
            toolsAllowlist: data.toolsAllowlist,
            enabled: true,
            verifyTls: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdById: data.createdById,
          }
        }),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(mcpServerRouter)(baseContext(prismaMock))
    const result = await caller.create({
      workspaceId: WORKSPACE_ID,
      name: 'Notion',
      url: 'https://mcp.notion.com',
      transport: 'HTTP_JSONRPC',
      headers: { Authorization: 'Bearer secret-token' },
    })

    expect(result.name).toBe('Notion')
    expect((result as any).headers).toBeUndefined()
    expect(storedHeadersJson).not.toContain('secret-token')
  })

  it('rejects non-owner', async () => {
    const prismaMock = {
      workspaceMember: {
        findUnique: vi.fn().mockResolvedValue({ role: 'VIEWER', userId: USER_ID, workspaceId: WORKSPACE_ID }),
      },
      workspaceMcpServer: { create: vi.fn() },
    } as unknown as PrismaClient

    const caller = createCallerFactory(mcpServerRouter)(baseContext(prismaMock))
    await expect(
      caller.create({
        workspaceId: WORKSPACE_ID,
        name: 'Notion',
        url: 'https://mcp.notion.com',
        transport: 'HTTP_JSONRPC',
        headers: {},
      }),
    ).rejects.toThrow(/Недостаточно прав|FORBIDDEN/i)
  })
})

describe('mcpServer.list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns rows without headers', async () => {
    const row = {
      id: 'srv-1',
      workspaceId: WORKSPACE_ID,
      name: 'Notion',
      description: null,
      url: 'https://x',
      transport: 'HTTP_JSONRPC',
      headers: { ciphertext: 'x', iv: 'y', tag: 'z' },
      toolsAllowlist: [],
      enabled: true,
      verifyTls: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: USER_ID,
    }
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: { findMany: vi.fn().mockResolvedValue([row]) },
    } as unknown as PrismaClient

    const caller = createCallerFactory(mcpServerRouter)(baseContext(prismaMock))
    const rows = await caller.list({ workspaceId: WORKSPACE_ID })
    expect(rows).toHaveLength(1)
    expect((rows[0] as any).headers).toBeUndefined()
  })
})
