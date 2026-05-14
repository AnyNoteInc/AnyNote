import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { siteConfig } from '../../src/lib/seo/site-config'

const ENV_KEY = 'SEO_NOINDEX_ALL'

describe('robots', () => {
  let originalEnv: string | undefined

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY]
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = originalEnv
  })

  it('allows root and disallows protected/auth paths by default', async () => {
    delete process.env[ENV_KEY]
    const mod = await import(`../../src/app/robots?cache=${Date.now()}`)
    const config = mod.default()
    const rule = config.rules[0]
    expect(rule.allow).toBe('/')
    expect(rule.disallow).toEqual(
      expect.arrayContaining(['/app/', '/api/', '/sign-in', '/sign-up', '/settings/']),
    )
    expect(config.sitemap).toBe(`${siteConfig.url}/sitemap.xml`)
  })

  it('disallows the entire site when SEO_NOINDEX_ALL=true', async () => {
    process.env[ENV_KEY] = 'true'
    const mod = await import(`../../src/app/robots?cache=${Date.now() + 1}`)
    const config = mod.default()
    const rule = config.rules[0]
    expect(rule.disallow).toEqual(['/'])
  })
})
