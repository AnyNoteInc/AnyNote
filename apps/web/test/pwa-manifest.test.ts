import { describe, expect, it } from 'vitest'

import manifest from '@/app/manifest'
import { PWA_BACKGROUND_COLOR, PWA_THEME_COLOR } from '@/lib/pwa'

describe('app manifest', () => {
  const entry = manifest()

  it('describes the installable app shell', () => {
    expect(entry.name).toBe('AnyNote')
    expect(entry.short_name).toBe('AnyNote')
    expect(entry.description).toMatch(/[А-Яа-я]/)
    expect(entry.start_url).toBe('/app')
    expect(entry.display).toBe('standalone')
  })

  it('uses the shared dark-neutral brand pair (same constant as viewport.themeColor)', () => {
    expect(entry.theme_color).toBe(PWA_THEME_COLOR)
    expect(entry.background_color).toBe(PWA_BACKGROUND_COLOR)
    expect(PWA_THEME_COLOR).toMatch(/^#[0-9a-f]{6}$/i)
    expect(PWA_BACKGROUND_COLOR).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('lists the any, apple, and maskable icons at stable urls', () => {
    const icons = entry.icons ?? []
    expect(icons).toHaveLength(3)

    const any = icons.find((icon) => icon.src === '/icon')
    expect(any).toMatchObject({ sizes: '512x512', type: 'image/png', purpose: 'any' })

    const apple = icons.find((icon) => icon.src === '/apple-icon')
    expect(apple).toMatchObject({ sizes: '180x180', type: 'image/png' })

    const maskable = icons.find((icon) => icon.src === '/icon-maskable')
    expect(maskable).toMatchObject({ sizes: '512x512', type: 'image/png', purpose: 'maskable' })
  })
})
