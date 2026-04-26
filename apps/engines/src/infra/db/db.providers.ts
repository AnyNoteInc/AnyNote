import type { FactoryProvider } from '@nestjs/common'
import { prisma } from '@repo/db'
import type { PrismaClient } from '@repo/db'

export const PRISMA = Symbol('PRISMA_CLIENT')

export const prismaProvider: FactoryProvider<PrismaClient> = {
  provide: PRISMA,
  useFactory: () => prisma,
}
