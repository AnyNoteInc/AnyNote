import type { MetadataRoute } from 'next'

import { legalDocuments } from '@/lib/legal-documents'
import { siteConfig } from '@/lib/seo/site-config'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url
  const now = new Date()

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${base}/pricing`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
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
