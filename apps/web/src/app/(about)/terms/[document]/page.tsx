import { notFound } from 'next/navigation'

import { PublicPageShell } from '@/components/public/public-page-shell'
import { legalDocumentBySlug, legalDocuments, type LegalDocumentSlug } from '@/lib/legal-documents'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

import { LegalDocumentRenderer } from './legal-document-renderer'

export function generateStaticParams() {
  return legalDocuments.map((doc) => ({ document: doc.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>
}) {
  const { document } = await params
  const meta = legalDocumentBySlug[document as LegalDocumentSlug]
  if (!meta) {
    return buildMetadata({ title: 'Документ', path: `/terms/${document}`, noIndex: true })
  }
  return buildMetadata({
    title: meta.title,
    description: meta.summary,
    path: `/terms/${meta.slug}`,
  })
}

export default async function LegalDocumentPage({
  params,
}: Readonly<{
  params: Promise<{ document: string }>
}>) {
  const { document } = await params
  const meta = legalDocumentBySlug[document as LegalDocumentSlug]
  if (!meta) notFound()
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'Документы', url: `${siteConfig.url}/terms` },
    { name: meta.title, url: `${siteConfig.url}/terms/${meta.slug}` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <PublicPageShell eyebrow={meta.eyebrow} title={meta.title} description={meta.summary}>
        <LegalDocumentRenderer slug={meta.slug} />
      </PublicPageShell>
    </>
  )
}
