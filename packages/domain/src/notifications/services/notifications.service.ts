import { badRequest } from '../../shared/errors.ts'
import type { DeleteResultDto, MarkReadInput, MarkReadResultDto } from '../dto/notifications.dto.ts'
import type { NotificationRepository } from '../repositories/notifications.repository.ts'

export class NotificationService {
  constructor(private readonly repo: NotificationRepository) {}

  async markRead(actorUserId: string, input: MarkReadInput): Promise<MarkReadResultDto> {
    if (input.ids.length === 0) throw badRequest('ids must not be empty')
    return this.repo.markRead(actorUserId, input.ids)
  }

  async markAllRead(actorUserId: string): Promise<MarkReadResultDto> {
    return this.repo.markAllRead(actorUserId)
  }

  async deleteAll(actorUserId: string): Promise<DeleteResultDto> {
    return this.repo.deleteAll(actorUserId)
  }
}
