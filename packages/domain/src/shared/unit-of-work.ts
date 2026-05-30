import { AsyncLocalStorage } from 'node:async_hooks'

import type { Prisma, PrismaClient } from '@repo/db'

/** The active client: a tx handle inside transaction(), or the base PrismaClient outside. */
export type Db = PrismaClient | Prisma.TransactionClient

export interface UnitOfWork {
  /** Run fn inside a DB transaction; nested calls reuse the active tx. */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  /** The active tx if inside transaction(), else the base prisma client. */
  client(): Db
}

export class PrismaUnitOfWork implements UnitOfWork {
  private readonly als = new AsyncLocalStorage<Prisma.TransactionClient>()
  private readonly prisma: PrismaClient

  constructor(prisma: PrismaClient) {
    this.prisma = prisma
  }

  client(): Db {
    return this.als.getStore() ?? this.prisma
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    const active = this.als.getStore()
    if (active) return fn()
    return this.prisma.$transaction((tx) => this.als.run(tx, fn))
  }
}
