import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient } from '@repo/db'

import { createDomainContainer } from '../src/container.ts'
import { SHARED } from '../src/shared/tokens.ts'
import type { UnitOfWork } from '../src/shared/unit-of-work.ts'
import type { PeopleService } from '../src/people/services/people.service.ts'
import { PEOPLE } from '../src/people/people.tokens.ts'
import { makeScheduler } from './helpers.ts'

/**
 * A fake prisma that honestly models interactive-transaction semantics:
 * writes through the BASE client commit immediately (autocommit), writes
 * through the TX client passed to `$transaction(fn)` are staged and only
 * committed when fn resolves — a throw discards them (rollback).
 */
function makeTxPrisma() {
  const committed: unknown[] = []
  const makeDelegates = (sink: unknown[]) => ({
    workspaceAuditLog: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        sink.push(data)
        return data
      }),
    },
  })
  const prisma = {
    ...makeDelegates(committed),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const staged: unknown[] = []
      const result = await fn(makeDelegates(staged))
      committed.push(...staged)
      return result
    },
  }
  return { prisma: prisma as unknown as PrismaClient, committed }
}

function makeContainer() {
  const { prisma, committed } = makeTxPrisma()
  const container = createDomainContainer({ prisma, scheduler: makeScheduler() })
  return { container, committed }
}

type UowClient = { workspaceAuditLog: { create: (args: { data: unknown }) => Promise<unknown> } }

describe('SHARED.UnitOfWork container scope', () => {
  it('resolves the SAME UnitOfWork instance on every get (singleton)', () => {
    const { container } = makeContainer()
    const a = container.get<UnitOfWork>(SHARED.UnitOfWork)
    const b = container.get<UnitOfWork>(SHARED.UnitOfWork)
    expect(a).toBe(b)
  })

  it('a service and its repository share the same UnitOfWork (same ALS)', () => {
    const { container } = makeContainer()
    const people = container.get<PeopleService>(PEOPLE.Service)
    // TS-private fields are runtime-reachable; this pins the actual wiring
    // that the autocommit bug broke: service tx ALS ≠ repository client ALS.
    const serviceUow = (people as unknown as { uow: UnitOfWork }).uow
    const repoUow = (people as unknown as { repo: { uow: UnitOfWork } }).repo.uow
    expect(serviceUow).toBe(repoUow)
  })

  it('a write through a separately resolved uow.client() inside another resolution\'s transaction rolls back on throw', async () => {
    const { container, committed } = makeContainer()
    // Mirrors the service/repository split: the "service" uow opens the tx,
    // the "repository" uow performs the write via client().
    const serviceUow = container.get<UnitOfWork>(SHARED.UnitOfWork)
    const repoUow = container.get<UnitOfWork>(SHARED.UnitOfWork)
    await expect(
      serviceUow.transaction(async () => {
        await (repoUow.client() as unknown as UowClient).workspaceAuditLog.create({
          data: { action: 'doomed' },
        })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    // Pre-fix this write went through the base client (autocommit) and survived.
    expect(committed).toHaveLength(0)
  })

  it('semantics pin: same-instance transaction rolls back writes on throw', async () => {
    const { container, committed } = makeContainer()
    const uow = container.get<UnitOfWork>(SHARED.UnitOfWork)
    await expect(
      uow.transaction(async () => {
        await (uow.client() as unknown as UowClient).workspaceAuditLog.create({
          data: { action: 'doomed' },
        })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(committed).toHaveLength(0)
  })

  it('semantics pin: transaction commits writes when fn resolves', async () => {
    const { container, committed } = makeContainer()
    const uow = container.get<UnitOfWork>(SHARED.UnitOfWork)
    await uow.transaction(async () => {
      await (uow.client() as unknown as UowClient).workspaceAuditLog.create({
        data: { action: 'kept' },
      })
    })
    expect(committed).toEqual([{ action: 'kept' }])
  })
})
