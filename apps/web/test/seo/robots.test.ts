import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { siteConfig } from '../../src/lib/seo/site-config'

const ENV_KEY = 'SEO_NOINDEX_ALL'

describe('robots', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY]
    vi.resetModules()
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = originalEnv
  })

  it('allows root and disallows protected/auth paths by default', async () => {
    delete process.env[ENV_KEY]
    const { default: robots } = await import('../../src/app/robots')
    const config = robots()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rule = (config.rules as any[])[0]
    expect(rule.allow).toBe('/')
    expect(rule.disallow).toEqual(
      expect.arrayContaining(['/app/', '/api/', '/sign-in', '/sign-up', '/settings/']),
    )
    expect(config.sitemap).toBe(`${siteConfig.url}/sitemap.xml`)
  })

  it('disallows the entire site when SEO_NOINDEX_ALL=true', async () => {
    process.env[ENV_KEY] = 'true'
    const { default: robots } = await import('../../src/app/robots')
    const config = robots()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rule = (config.rules as any[])[0]
    expect(rule.disallow).toEqual(['/'])
  })
})
