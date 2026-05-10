import 'server-only'

import { setDocumentVersionResolver } from '@repo/trpc'

import { legalDocumentByConsentType } from './legal-documents'

setDocumentVersionResolver((type) => {
  const doc = legalDocumentByConsentType[type]
  return doc?.version ?? 'unknown'
})
