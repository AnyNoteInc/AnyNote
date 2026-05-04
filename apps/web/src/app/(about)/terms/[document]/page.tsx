import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { PublicPageShell } from '@/components/public/public-page-shell'
import { legalDocumentBySlug, legalDocuments, type LegalDocumentSlug } from '@/lib/legal-documents'

import { LegalDocumentRenderer } from './legal-document-renderer'

export function generateStaticParams() {
  return legalDocuments.map((doc) => ({ document: doc.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ document: string }>
}): Promise<Metadata> {
  const { document } = await params
  const meta = legalDocumentBySlug[document as LegalDocumentSlug]
  return { title: meta?.title ?? 'Документ' }
}

export default async function LegalDocumentPage({
  params,
}: Readonly<{
  params: Promise<{ document: string }>
}>) {
  const { document } = await params
  const meta = legalDocumentBySlug[document as LegalDocumentSlug]
  if (!meta) notFound()
  return (
    <PublicPageShell eyebrow={meta.eyebrow} title={meta.title} description={meta.summary}>
      <LegalDocumentRenderer slug={meta.slug} />
    </PublicPageShell>
  )
}
