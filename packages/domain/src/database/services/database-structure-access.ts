import type { DatabaseRepository } from '../repositories/database.repository.ts'
import { forbidden } from '../../shared/errors.ts'

export interface DatabaseStructureSource {
  workspaceId: string
  pageCreatedById: string | null
  structureLocked: boolean
}

export async function assertCanEditDatabaseStructure(
  repository: Pick<DatabaseRepository, 'findWorkspaceRole'>,
  actorUserId: string,
  source: DatabaseStructureSource,
): Promise<void> {
  const role = await repository.findWorkspaceRole(actorUserId, source.workspaceId)
  if (role === 'OWNER' || role === 'ADMIN') return
  if (source.structureLocked) throw forbidden('Структура заблокирована')
  if (source.pageCreatedById === actorUserId) return
  throw forbidden('Недостаточно прав для изменения структуры')
}
