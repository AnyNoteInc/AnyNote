import type { EntityId } from "../types"

export function createId<T extends EntityId>(): T {
  return globalThis.crypto.randomUUID() as T
}
