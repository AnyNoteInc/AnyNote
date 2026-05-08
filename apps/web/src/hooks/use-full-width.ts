'use client'

import { usePagePref, type UsePagePrefOptions } from './use-page-pref'

const OPTIONS: UsePagePrefOptions<boolean> = {
  storageKeyPrefix: 'page-full-width',
  eventName: 'anynote:full-width-change',
  defaultValue: false,
  parse: (raw) => raw === 'true',
  serialize: (v) => String(v),
}

export function useFullWidth(pageId: string) {
  return usePagePref(pageId, OPTIONS)
}
