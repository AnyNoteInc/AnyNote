import { ContainerModule } from 'inversify'

import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import { PAGES } from '../pages/pages.tokens.ts'
import type { PageService } from '../pages/services/pages.service.ts'
import { TemplateRepository } from './repositories/templates.repository.ts'
import { TemplateService } from './services/templates.service.ts'
import { TEMPLATES } from './templates.tokens.ts'

export const templatesModule = new ContainerModule(({ bind }) => {
  bind(TEMPLATES.Repository).toResolvedValue(
    (uow, pages) => new TemplateRepository(uow as UnitOfWork, pages as PageService),
    [SHARED.UnitOfWork, PAGES.Service],
  )
  bind(TEMPLATES.Service).toResolvedValue(
    (repo, uow) => new TemplateService(repo as TemplateRepository, uow as UnitOfWork),
    [TEMPLATES.Repository, SHARED.UnitOfWork],
  )
})
