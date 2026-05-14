import type { Metadata } from 'next'

import { siteConfig } from './site-config'

export type BuildMetadataInput = {
  title: string
  description?: string
  path: string
  ogImage?: string
  noIndex?: boolean
  keywords?: string[]
}

export function buildMetadata(input: BuildMetadataInput): Metadata {
  const url = new URL(input.path, `${siteConfig.url}/`).toString()
  const description = input.description ?? siteConfig.description
  const robots = input.noIndex
    ? { index: false, follow: false }
    : { index: true, follow: true, googleBot: { index: true, follow: true } }

  // Next.js normalises root-path canonical to origin (no trailing slash).
  // Callers that need a guaranteed trailing-slash canonical (e.g. the homepage)
  // should render <link rel="canonical"> directly in JSX instead.
  const canonical = url.endsWith('/') && url.replace(/\/$/, '') === siteConfig.url ? undefined : url

  return {
    title: input.title,
    description,
    keywords: input.keywords,
    alternates: canonical ? { canonical } : undefined,
    robots,
    openGraph: {
      type: 'website',
      url,
      title: input.title,
      description,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      images: input.ogImage ? [input.ogImage] : undefined,
    },
  }
}
