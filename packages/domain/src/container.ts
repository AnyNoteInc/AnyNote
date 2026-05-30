import 'reflect-metadata'

import { Container } from 'inversify'
import type { PrismaClient } from '@repo/db'

import { SHARED } from './shared/tokens.ts'
import { PrismaUnitOfWork } from './shared/unit-of-work.ts'
import { WORKSPACE } from './workspace/workspace.tokens.ts'
import { workspaceModule } from './workspace/workspace.module.ts'
import type { WorkspaceService } from './workspace/services/workspace.service.ts'
import { FAVORITES } from './favorites/favorites.tokens.ts'
import { favoritesModule } from './favorites/favorites.module.ts'
import type { FavoriteService } from './favorites/services/favorites.service.ts'

export interface DomainDeps {
  prisma: PrismaClient
}

export interface Domain {
  workspace: WorkspaceService
  favorites: FavoriteService
}

export function createDomainContainer(deps: DomainDeps): Container {
  const c = new Container()
  c.bind(SHARED.Prisma).toConstantValue(deps.prisma)
  c.bind(SHARED.UnitOfWork).toResolvedValue(
    (prisma) => new PrismaUnitOfWork(prisma as PrismaClient),
    [SHARED.Prisma],
  )
  c.load(workspaceModule, favoritesModule)
  return c
}

export function createDomain(deps: DomainDeps): Domain {
  const c = createDomainContainer(deps)
  return {
    workspace: c.get<WorkspaceService>(WORKSPACE.Service),
    favorites: c.get<FavoriteService>(FAVORITES.Service),
  }
}
