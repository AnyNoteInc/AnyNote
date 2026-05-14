import { ConsentDocumentType } from '@repo/db'

import type { LegalDocumentSlug } from './legal-doc-labels'

export type { LegalDocumentSlug }

export type LegalDocument = {
  slug: LegalDocumentSlug
  title: string
  eyebrow: string
  summary: string
  href: string
  /** Consent enum mapped to this document, or null for purely informational pages. */
  consentType: ConsentDocumentType | null
  /** Whether this consent must be granted before the user can use the service. */
  required: boolean
  /**
   * Manually maintained version string. Bump when the document text changes
   * meaningfully — this value is recorded in `user_consents.document_version`
   * for audit purposes.
   */
  version: string
}

export const legalDocuments: readonly LegalDocument[] = [
  {
    slug: 'user-agreement',
    title: 'Пользовательское соглашение',
    eyebrow: 'СОГЛАШЕНИЕ',
    summary: 'Условия использования сервиса, прав и обязанностей пользователя и администрации.',
    href: '/terms/user-agreement',
    consentType: ConsentDocumentType.USER_AGREEMENT,
    required: true,
    version: '2026-05-04',
  },
  {
    slug: 'privacy-policy',
    title: 'Политика обработки персональных данных',
    eyebrow: 'КОНФИДЕНЦИАЛЬНОСТЬ',
    summary: 'Какие данные мы собираем, цели и условия их обработки и хранения.',
    href: '/terms/privacy-policy',
    consentType: ConsentDocumentType.PRIVACY_POLICY,
    required: true,
    version: '2026-05-04',
  },
  {
    slug: 'consent',
    title: 'Согласие на обработку персональных данных',
    eyebrow: 'СОГЛАСИЕ',
    summary:
      'Согласие пользователя на обработку персональных данных при регистрации и использовании сервиса.',
    href: '/terms/consent',
    consentType: ConsentDocumentType.PII_PROCESSING,
    required: true,
    version: '2026-05-04',
  },
  {
    slug: 'marketing-consent',
    title: 'Согласие на получение информационных и рекламных рассылок',
    eyebrow: 'РАССЫЛКИ',
    summary:
      'Согласие на получение информационных, сервисных и рекламных писем по электронной почте.',
    href: '/terms/marketing-consent',
    consentType: ConsentDocumentType.MARKETING,
    required: false,
    version: '2026-05-10',
  },
  {
    slug: 'public-offer',
    title: 'Публичная оферта',
    eyebrow: 'ОФЕРТА',
    summary:
      'Договор-оферта на оказание услуг по предоставлению доступа к функциональности сервиса.',
    href: '/terms/public-offer',
    consentType: ConsentDocumentType.PUBLIC_OFFER,
    required: true,
    version: '2026-05-04',
  },
  {
    slug: 'information',
    title: 'Информация о самозанятом',
    eyebrow: 'РЕКВИЗИТЫ',
    summary: 'Реквизиты исполнителя и контактные данные для обращений.',
    href: '/terms/information',
    consentType: null,
    required: false,
    version: '2026-05-04',
  },
] as const

export const legalDocumentBySlug: Record<LegalDocumentSlug, LegalDocument> = Object.fromEntries(
  legalDocuments.map((doc) => [doc.slug, doc]),
) as Record<LegalDocumentSlug, LegalDocument>

export const legalDocumentByConsentType: Partial<Record<ConsentDocumentType, LegalDocument>> =
  Object.fromEntries(
    legalDocuments
      .filter(
        (doc): doc is LegalDocument & { consentType: ConsentDocumentType } =>
          doc.consentType !== null,
      )
      .map((doc) => [doc.consentType, doc]),
  )
