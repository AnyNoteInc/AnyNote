import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { siteConfig } from '../../src/lib/seo/site-config'

const ENV_KEY = 'SEO_NOINDEX_ALL'

type Rule = { allow?: string | string[]; disallow?: string | string[] }

function firstRule(rules: Rule | Rule[]): Rule {
  const rule = Array.isArray(rules) ? rules[0] : rules
  if (!rule) throw new Error('robots config has no rules')
  return rule
}

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
    const rule = firstRule(config.rules)
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
    const rule = firstRule(config.rules)
    expect(rule.disallow).toEqual(['/'])
  })
})
