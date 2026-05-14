import type { MetadataRoute } from 'next'

import { legalDocuments } from '@/lib/legal-documents'
import { siteConfig } from '@/lib/seo/site-config'

// Bump when public pages change meaningfully so crawlers come back. Static
// dates (not new Date()) keep sitemap.xml stable across requests — crawlers
// otherwise see every page claiming it just changed.
const STATIC_PAGES_LAST_MODIFIED = new Date('2026-05-14')

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url

  return [
    {
      url: `${base}/`,
      lastModified: STATIC_PAGES_LAST_MODIFIED,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${base}/pricing`,
      lastModified: STATIC_PAGES_LAST_MODIFIED,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/terms`,
      lastModified: STATIC_PAGES_LAST_MODIFIED,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    ...legalDocuments.map((doc) => ({
      url: `${base}/terms/${doc.slug}`,
      lastModified: new Date(doc.version),
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ]
}
