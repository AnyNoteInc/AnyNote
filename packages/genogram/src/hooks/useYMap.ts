import { useCallback, useRef, useSyncExternalStore } from "react"
import type * as Y from "yjs"

/**
 * Subscribe to a Y.Map via useSyncExternalStore. Returns the map contents
 * as a plain record, refreshed whenever the map (or any nested Y type
 * inside it) mutates.
 *
 * The snapshot is cached until a change fires, so repeated renders return
 * a stable reference — required for React's memoization.
 */
export function useYMap<T>(map: Y.Map<T>): Record<string, T> {
  const cacheRef = useRef<{ map: Y.Map<T>; snapshot: Record<string, T> | null }>({
    map,
    snapshot: null,
  })

  if (cacheRef.current.map !== map) {
    cacheRef.current = { map, snapshot: null }
  }

  const subscribe = useCallback(
    (onChange: () => void) => {
      const handler = () => {
        cacheRef.current.snapshot = null
        onChange()
      }
      map.observeDeep(handler)
      return () => map.unobserveDeep(handler)
    },
    [map],
  )

  const getSnapshot = useCallback((): Record<string, T> => {
    if (cacheRef.current.snapshot === null) {
      cacheRef.current.snapshot = mapToRecord(map)
    }
    return cacheRef.current.snapshot
  }, [map])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function mapToRecord<T>(map: Y.Map<T>): Record<string, T> {
  const out: Record<string, T> = {}
  map.forEach((value, key) => {
    out[key] = value
  })
  return out
}
