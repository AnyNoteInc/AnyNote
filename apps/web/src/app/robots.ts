import type { MetadataRoute } from 'next'

import { siteConfig } from '@/lib/seo/site-config'

export default function robots(): MetadataRoute.Robots {
  const sitemapUrl = `${siteConfig.url}/sitemap.xml`

  if (process.env.SEO_NOINDEX_ALL === 'true') {
    return {
      rules: [{ userAgent: '*', disallow: ['/'] }],
      sitemap: sitemapUrl,
      host: siteConfig.url,
    }
  }

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/app/',
          '/api/',
          '/sign-in',
          '/sign-up',
          '/reset-credentials',
          '/verify-email',
          '/onboarding/',
          '/settings/',
          '/profile',
          '/workspaces/',
          '/notifications',
        ],
      },
    ],
    sitemap: sitemapUrl,
    host: siteConfig.url,
  }
}
