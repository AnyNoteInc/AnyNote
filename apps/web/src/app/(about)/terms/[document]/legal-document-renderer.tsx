'use client'

import type { ComponentType } from 'react'

import UserAgreement from '@docs/terms/UserAgreement.md'
import PrivacyPolicy from '@docs/terms/PrivacyPolicy.md'
import Consent from '@docs/terms/ConsentToProcessing.md'
import PublicOffer from '@docs/terms/PublicOffer.md'
import Information from '@docs/terms/Information.md'

import type { LegalDocumentSlug } from '@/lib/legal-documents'

const documentComponents: Record<LegalDocumentSlug, ComponentType> = {
  'user-agreement': UserAgreement,
  'privacy-policy': PrivacyPolicy,
  consent: Consent,
  'public-offer': PublicOffer,
  information: Information,
}

export function LegalDocumentRenderer({ slug }: { slug: LegalDocumentSlug }) {
  const Component = documentComponents[slug]
  return <Component />
}
