import { describe, expect, it } from 'vitest'

// The canonical whitelist (domain, validates page.update) and the web CSS map
// (renders the band/picker) MUST stay key-identical — this is the drift guard
// the spec pins (§2): both sides are imported and compared, so adding/renaming
// a preset in one place without the other fails here.
import { COVER_PRESET_KEYS } from '@repo/domain/pages/dto/cover-presets.ts'

import { COVER_PRESET_CSS } from '../src/components/page/cover-presets'
import {
  PAGE_ICON_URL_PREFIX,
  pageIconImageUrl,
  pageIconValue,
} from '../src/components/page/page-icon-format'

describe('cover preset drift guard (domain keys ≡ web CSS map)', () => {
  it('the CSS map covers exactly the domain whitelist', () => {
    const domainKeys = [...COVER_PRESET_KEYS].sort((a, b) => a.localeCompare(b))
    const cssKeys = Object.keys(COVER_PRESET_CSS).sort((a, b) => a.localeCompare(b))
    expect(cssKeys).toEqual(domainKeys)
  })

  it('every preset value is a CSS gradient', () => {
    for (const key of COVER_PRESET_KEYS) {
      expect(COVER_PRESET_CSS[key]).toMatch(/^linear-gradient\(/)
    }
  })

  it('has the ten presets the spec names', () => {
    expect(COVER_PRESET_KEYS).toHaveLength(10)
  })
})

describe('page icon format helpers', () => {
  it('plain values (emoji) are NOT image icons — back-compat pinned', () => {
    expect(pageIconImageUrl('📄')).toBeNull()
    expect(pageIconImageUrl('🚀')).toBeNull()
    expect(pageIconImageUrl('abc')).toBeNull()
    expect(pageIconImageUrl(null)).toBeNull()
    expect(pageIconImageUrl(undefined)).toBeNull()
    expect(pageIconImageUrl('')).toBeNull()
  })

  it('url:-prefixed values parse to the image URL', () => {
    expect(pageIconImageUrl('url:/api/files/123e4567-e89b-12d3-a456-426614174000')).toBe(
      '/api/files/123e4567-e89b-12d3-a456-426614174000',
    )
    expect(pageIconImageUrl('url:https://example.com/pic.png')).toBe(
      'https://example.com/pic.png',
    )
  })

  it('a bare prefix with no URL is not an image icon', () => {
    expect(pageIconImageUrl(PAGE_ICON_URL_PREFIX)).toBeNull()
  })

  it('serialize → parse round-trips', () => {
    const url = '/api/files/123e4567-e89b-12d3-a456-426614174000'
    expect(pageIconValue(url)).toBe(`url:${url}`)
    expect(pageIconImageUrl(pageIconValue(url))).toBe(url)
  })
})
