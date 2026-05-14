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

  return {
    title: input.title,
    description,
    keywords: input.keywords,
    alternates: { canonical: url },
    robots,
    openGraph: {
      type: 'website',
      url,
      title: input.title,
      description,
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      images: [input.ogImage ?? defaultOgImagePath(input.path)],
    },
  }
}

function defaultOgImagePath(path: string): string {
  const normalized = path === '/' ? '' : path.replace(/\/$/, '')
  return `${normalized}/opengraph-image`
}
