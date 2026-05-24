export type PageCommentEvent = {
  kind: 'thread.upserted' | 'thread.deleted'
  threadId: string
}

type Listener = (event: PageCommentEvent) => void

export class PageCommentBus {
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

  emit(pageId: string, event: PageCommentEvent): void {
    const set = this.listeners.get(pageId)
    if (!set) return
    for (const listener of set) listener(event)
  }
}

export const pageCommentBus = new PageCommentBus()
