import { ContainerModule } from 'inversify'

// Deep token import ON PURPOSE (not the people barrel): people.service imports
// `securityError` from THIS module's barrel for the createGuestInvite policy
// gate, so a people-barrel import here would close an import cycle
// (people.service → security/index → security.module → people/index →
// people.service). people.tokens.ts is import-free, and module files sit
// outside the domain-module-isolation rule (it scopes dto/repositories/services).
import { PEOPLE } from '../people/people.tokens.ts'
import { SHARED } from '../shared/tokens.ts'
import type { UnitOfWork } from '../shared/unit-of-work.ts'
import type { SecurityGuestInviteCreator } from './dto/security.dto.ts'
import { SecurityRepository } from './repositories/security.repository.ts'
import { SecurityService } from './services/security.service.ts'
import { SECURITY } from './security.tokens.ts'

export const securityModule = new ContainerModule(({ bind }) => {
  bind(SECURITY.Repository).toResolvedValue(
    (uow) => new SecurityRepository(uow as UnitOfWork),
    [SHARED.UnitOfWork],
  )
  bind(SECURITY.Service).toResolvedValue(
    (repo, uow, people) =>
      new SecurityService(
        repo as SecurityRepository,
        uow as UnitOfWork,
        // approveGuestInviteRequest runs people.createGuestInvite with
        // `bypassPolicy: true` inside the approve tx (ALS join) — the ONLY
        // sanctioned bypass of disableGuestInvites (spec §7.4). The cast onto
        // the structural port is pinned compile-time in the security suite.
        people as SecurityGuestInviteCreator,
      ),
    [SECURITY.Repository, SHARED.UnitOfWork, PEOPLE.Service],
  )
})
