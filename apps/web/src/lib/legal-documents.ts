export type LegalDocumentSlug =
  | 'user-agreement'
  | 'privacy-policy'
  | 'consent'
  | 'public-offer'
  | 'information'

export type LegalDocument = {
  slug: LegalDocumentSlug
  title: string
  eyebrow: string
  summary: string
  href: string
}

export const legalDocuments: readonly LegalDocument[] = [
  {
    slug: 'user-agreement',
    title: 'Пользовательское соглашение',
    eyebrow: 'СОГЛАШЕНИЕ',
    summary: 'Условия использования сервиса, прав и обязанностей пользователя и администрации.',
    href: '/terms/user-agreement',
  },
  {
    slug: 'privacy-policy',
    title: 'Политика обработки персональных данных',
    eyebrow: 'КОНФИДЕНЦИАЛЬНОСТЬ',
    summary: 'Какие данные мы собираем, цели и условия их обработки и хранения.',
    href: '/terms/privacy-policy',
  },
  {
    slug: 'consent',
    title: 'Согласие на обработку персональных данных',
    eyebrow: 'СОГЛАСИЕ',
    summary:
      'Согласие пользователя на обработку персональных данных при регистрации и использовании сервиса.',
    href: '/terms/consent',
  },
  {
    slug: 'public-offer',
    title: 'Публичная оферта',
    eyebrow: 'ОФЕРТА',
    summary:
      'Договор-оферта на оказание услуг по предоставлению доступа к функциональности сервиса.',
    href: '/terms/public-offer',
  },
  {
    slug: 'information',
    title: 'Информация о самозанятом',
    eyebrow: 'РЕКВИЗИТЫ',
    summary: 'Реквизиты исполнителя и контактные данные для обращений.',
    href: '/terms/information',
  },
] as const

export const legalDocumentBySlug: Record<LegalDocumentSlug, LegalDocument> = Object.fromEntries(
  legalDocuments.map((doc) => [doc.slug, doc]),
) as Record<LegalDocumentSlug, LegalDocument>
