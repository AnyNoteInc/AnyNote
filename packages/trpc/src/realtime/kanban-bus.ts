export type KanbanEvent =
  | { kind: 'task.created' | 'task.updated' | 'task.deleted' | 'task.moved'; taskId: string }
  | { kind: 'column.upserted' | 'column.deleted'; columnId: string }
  | { kind: 'sprint.upserted' | 'sprint.deleted'; sprintId: string }
  | { kind: 'comment.upserted' | 'comment.deleted'; taskId: string; commentId: string }
  | { kind: 'settings.upserted'; entity: 'type' | 'priority' | 'label' }
  | { kind: 'activity.appended'; taskId: string }

type Listener = (event: KanbanEvent) => void

export class KanbanBus {
  private readonly listeners = new Map<string, Set<Listener>>()

  on(pageId: string, listener: Listener): () => void {
    const existing = this.listeners.get(pageId)
    const set = existing ?? new Set<Listener>()
    if (!existing) this.listeners.set(pageId, set)
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(pageId)
    }
  }

  emit(pageId: string, event: KanbanEvent): void {
    const set = this.listeners.get(pageId)
    if (!set) return
    for (const listener of set) listener(event)
  }

  listenerCount(pageId: string): number {
    return this.listeners.get(pageId)?.size ?? 0
  }
}

export const kanbanBus = new KanbanBus()
