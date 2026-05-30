import type { FactoryProvider } from '@nestjs/common'
import { prisma } from '@repo/db'
import { createDomain } from '@repo/domain'
import type { Domain } from '@repo/domain'

export const DOMAIN = Symbol('DOMAIN')

export const domainProvider: FactoryProvider<Domain> = {
  provide: DOMAIN,
  useFactory: () => createDomain({ prisma }),
}
