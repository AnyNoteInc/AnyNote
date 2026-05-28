import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

const { validateMcpMock, getWorkspaceFeaturesMock } = vi.hoisted(() => ({
  validateMcpMock: vi.fn(),
  getWorkspaceFeaturesMock: vi.fn(),
}))

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

vi.mock('../src/helpers/agents-validate', () => ({ validateMcp: validateMcpMock }))
vi.mock('../src/helpers/plan', () => ({ getWorkspaceFeatures: getWorkspaceFeaturesMock }))

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
    validateMcpMock.mockResolvedValue({ ok: true, tools: [], error: null })
    getWorkspaceFeaturesMock.mockResolvedValue({ customMcpEnabled: true })
  })

  it('encrypts headers at rest and returns a row without them', async () => {
    let storedHeadersJson: string | null = null
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
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
    expect((result as { headers?: unknown }).headers).toBeUndefined()
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

  it('blocks create when the MCP ping fails', async () => {
    validateMcpMock.mockResolvedValue({ ok: false, tools: [], error: 'unreachable' })
    const createSpy = vi.fn()
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: { create: createSpy },
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
    ).rejects.toThrow(/unreachable/)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('blocks create when customMcpEnabled is false', async () => {
    getWorkspaceFeaturesMock.mockResolvedValue({ customMcpEnabled: false })
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
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
    ).rejects.toThrow(/CUSTOM_MCP_NOT_IN_PLAN|FORBIDDEN/i)
  })
})

describe('mcpServer.list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateMcpMock.mockResolvedValue({ ok: true, tools: [], error: null })
    getWorkspaceFeaturesMock.mockResolvedValue({ customMcpEnabled: true })
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
    expect((rows[0] as { headers?: unknown } | undefined)?.headers).toBeUndefined()
  })
})

const SERVER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function existingServer(overrides: Record<string, unknown> = {}) {
  return {
    id: SERVER_ID,
    workspaceId: WORKSPACE_ID,
    name: 'MyServer',
    description: null,
    url: 'https://mcp.example.com',
    transport: 'HTTP_JSONRPC',
    headers: { ciphertext: 'x', iv: 'y', tag: 'z' },
    toolsAllowlist: [],
    enabled: true,
    verifyTls: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: USER_ID,
    ...overrides,
  }
}

describe('mcpServer.update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateMcpMock.mockResolvedValue({ ok: true, tools: [], error: null })
    getWorkspaceFeaturesMock.mockResolvedValue({ customMcpEnabled: true })
  })

  it('updates name only (skips re-ping) and returns row without headers', async () => {
    const updatedRow = existingServer({ name: 'Renamed' })
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: {
        findFirst: vi.fn().mockResolvedValue(existingServer()),
        update: vi.fn().mockResolvedValue(updatedRow),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(mcpServerRouter)(baseContext(prismaMock))
    const result = await caller.update({ id: SERVER_ID, workspaceId: WORKSPACE_ID, name: 'Renamed' })
    expect(result.name).toBe('Renamed')
    expect((result as { headers?: unknown }).headers).toBeUndefined()
    expect(validateMcpMock).not.toHaveBeenCalled()
  })

  it('rejects NOT_FOUND when the server is not in the workspace', async () => {
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(mcpServerRouter)(baseContext(prismaMock))
    await expect(
      caller.update({ id: SERVER_ID, workspaceId: WORKSPACE_ID, name: 'x' }),
    ).rejects.toThrow(/NOT_FOUND/)
  })
})

describe('mcpServer.delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes the server and returns ok', async () => {
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: {
        findFirst: vi.fn().mockResolvedValue(existingServer()),
        delete: vi.fn().mockResolvedValue(existingServer()),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(mcpServerRouter)(baseContext(prismaMock))
    const result = await caller.delete({ id: SERVER_ID, workspaceId: WORKSPACE_ID })
    expect(result.ok).toBe(true)
  })

  it('rejects NOT_FOUND when the server is not in the workspace', async () => {
    const prismaMock = {
      workspaceMember: { findUnique: vi.fn().mockResolvedValue(ownerMember()) },
      workspaceMcpServer: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient

    const caller = createCallerFactory(mcpServerRouter)(baseContext(prismaMock))
    await expect(
      caller.delete({ id: SERVER_ID, workspaceId: WORKSPACE_ID }),
    ).rejects.toThrow(/NOT_FOUND/)
  })
})
