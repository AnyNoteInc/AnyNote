export type LegalDocumentSlug =
  | 'user-agreement'
  | 'privacy-policy'
  | 'consent'
  | 'marketing-consent'
  | 'public-offer'
  | 'information'

export type LegalDocLabel = {
  eyebrow: string
  title: string
}

export const legalDocLabels: Record<LegalDocumentSlug, LegalDocLabel> = {
  'user-agreement': {
    eyebrow: 'СОГЛАШЕНИЕ',
    title: 'Пользовательское соглашение',
  },
  'privacy-policy': {
    eyebrow: 'КОНФИДЕНЦИАЛЬНОСТЬ',
    title: 'Политика обработки персональных данных',
  },
  consent: {
    eyebrow: 'СОГЛАСИЕ',
    title: 'Согласие на обработку персональных данных',
  },
  'marketing-consent': {
    eyebrow: 'РАССЫЛКИ',
    title: 'Согласие на получение информационных и рекламных рассылок',
  },
  'public-offer': {
    eyebrow: 'ОФЕРТА',
    title: 'Публичная оферта',
  },
  information: {
    eyebrow: 'РЕКВИЗИТЫ',
    title: 'Информация о самозанятом',
  },
}
