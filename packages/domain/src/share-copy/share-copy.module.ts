import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { ShareCopyRepository } from './repositories/share-copy.repository.ts'
import { PublicShareCopyService } from './services/share-copy.service.ts'
import { SHARE_COPY } from './share-copy.tokens.ts'

export const shareCopyModule = new ContainerModule(({ bind }) => {
  bind(SHARE_COPY.Repository).toResolvedValue(
    (uow) => new ShareCopyRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(SHARE_COPY.Service).toResolvedValue(
    (repo, uow) => new PublicShareCopyService(repo as ShareCopyRepository, uow as UnitOfWork),
    [SHARE_COPY.Repository, SHARED.UnitOfWork],
  )
})
