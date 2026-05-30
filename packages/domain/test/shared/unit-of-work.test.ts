import { describe, it, expect, vi } from 'vitest'
import type { PrismaClient, Prisma } from '@repo/db'

import { PrismaUnitOfWork } from '../../src/shared/unit-of-work.ts'

function makePrisma() {
  const tx = { __isTx: true } as unknown as Prisma.TransactionClient
  const client = {
    $transaction: vi.fn(async (fn: (t: Prisma.TransactionClient) => unknown) => fn(tx)),
  }
  return { tx, prisma: client as unknown as PrismaClient }
}

describe('PrismaUnitOfWork', () => {
  it('client() returns the base prisma outside a transaction', () => {
    const { prisma } = makePrisma()
    const uow = new PrismaUnitOfWork(prisma)
    expect(uow.client()).toBe(prisma)
  })

  it('client() returns the tx inside transaction()', async () => {
    const { prisma, tx } = makePrisma()
    const uow = new PrismaUnitOfWork(prisma)
    let inside: unknown
    const result = await uow.transaction(async () => {
      inside = uow.client()
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(inside).toBe(tx)
  })

  it('nested transaction() joins the active tx (only one $transaction)', async () => {
    const { prisma, tx } = makePrisma()
    const uow = new PrismaUnitOfWork(prisma)
    await uow.transaction(async () => {
      await uow.transaction(async () => {
        expect(uow.client()).toBe(tx)
      })
    })
    expect((prisma.$transaction as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce()
  })
})
