import { ContainerModule } from 'inversify'
import type { PrismaClient } from '@repo/db'

import { SHARED } from '../shared/tokens.ts'
import { ShareAccessRepository } from './repositories/share-access.repository.ts'
import { ShareAccessService } from './services/share-access.service.ts'
import { SHARE_ACCESS } from './share-access.tokens.ts'

export const shareAccessModule = new ContainerModule(({ bind }) => {
  bind(SHARE_ACCESS.Repository).toResolvedValue(
    (prisma) => new ShareAccessRepository(prisma as PrismaClient),
    [SHARED.Prisma],
  )
  bind(SHARE_ACCESS.Service).toResolvedValue(
    (repo) => new ShareAccessService(repo as ShareAccessRepository),
    [SHARE_ACCESS.Repository],
  )
})
