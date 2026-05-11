'use client'

import { usePagePref, type UsePagePrefOptions } from './use-page-pref'

export type OutlineMode = 'off' | 'mini' | 'full'

function isOutlineMode(value: string | null): value is OutlineMode {
  return value === 'off' || value === 'mini' || value === 'full'
}

const OPTIONS: UsePagePrefOptions<OutlineMode> = {
  storageKeyPrefix: 'page-outline-mode',
  eventName: 'anynote:outline-mode-change',
  defaultValue: 'mini',
  parse: (raw) => (isOutlineMode(raw) ? raw : 'mini'),
  serialize: (v) => v,
}

export function useOutlineMode(pageId: string) {
  return usePagePref(pageId, OPTIONS)
}
