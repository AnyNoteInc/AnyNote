import type { UnitOfWork } from '../../shared/unit-of-work.ts'
import type { DeleteResultDto, MarkReadResultDto } from '../dto/notifications.dto.ts'

export class NotificationRepository {
  constructor(private readonly uow: UnitOfWork) {}

  async markRead(userId: string, ids: string[]): Promise<MarkReadResultDto> {
    const result = await this.uow.client().notificationInApp.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }

  async markAllRead(userId: string): Promise<MarkReadResultDto> {
    const result = await this.uow.client().notificationInApp.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: result.count }
  }

  async deleteAll(userId: string): Promise<DeleteResultDto> {
    const result = await this.uow.client().notificationInApp.deleteMany({
      where: { userId },
    })
    return { deleted: result.count }
  }
}
