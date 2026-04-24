import { describe, expect, it, jest } from "@jest/globals"

import { AgentsClient } from "../services/agents-client.service.js"
import { PageContentReader } from "../services/page-content-reader.service.js"
import { VectorizationCronService } from "./vectorization-cron.service.js"

function makePrismaMock(opts: { rows: unknown[]; page: unknown }) {
  const executeRaw = jest.fn(async () => 1)
  const findUnique = jest.fn(async () => opts.page)
  const queryRaw = jest.fn(async () => opts.rows)
  const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw }
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))
  return {
    $transaction: transaction,
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    page: { findUnique },
    __mocks: { executeRaw, findUnique, queryRaw, transaction },
  }
}

describe("VectorizationCronService", () => {
  it("no-op when no rows", async () => {
    const prisma = makePrismaMock({ rows: [], page: null })
    const agents = { vectorize: jest.fn(async () => undefined) } as unknown as AgentsClient
    const reader = new PageContentReader()
    const svc = new VectorizationCronService(prisma as never, reader, agents)
    await svc.tick()
    expect(agents.vectorize).not.toHaveBeenCalled()
  })

  it("calls agents for TEXT page with blocks", async () => {
    const rows = [{ id: BigInt(1), page_id: "p1", workspace_id: "w1" }]
    const page = {
      id: "p1", type: "TEXT", deletedAt: null, title: "T",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
      workspaceId: "w1",
    }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = { vectorize } as unknown as AgentsClient
    const reader = new PageContentReader()
    const svc = new VectorizationCronService(prisma as never, reader, agents)
    await svc.tick()
    expect(vectorize).toHaveBeenCalledTimes(1)
    const arg = (vectorize.mock.calls[0] as unknown as [{ contents: unknown[] }])[0]
    expect(arg.contents).toHaveLength(1)
  })

  it("calls agents with empty contents when page is deleted/non-TEXT", async () => {
    const rows = [{ id: BigInt(2), page_id: "p2", workspace_id: "w2" }]
    const page = { id: "p2", type: "TEXT", deletedAt: new Date(), title: "", content: null, workspaceId: "w2" }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = { vectorize } as unknown as AgentsClient
    const svc = new VectorizationCronService(prisma as never, new PageContentReader(), agents)
    await svc.tick()
    expect(vectorize).toHaveBeenCalledWith(expect.objectContaining({
      pageId: "p2", workspaceId: "w2", contents: [],
    }))
  })
})
