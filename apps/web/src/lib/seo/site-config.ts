const rawBaseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

export const siteConfig = {
  name: 'AnyNote',
  brandRu: 'Любые заметки',
  description:
    'Рабочая память команды с ИИ-поиском. Документы, схемы и заметки в одном пространстве.',
  url: rawBaseUrl.replace(/\/$/, ''),
  locale: 'ru_RU',
  organization: {
    legalName: 'AnyNote',
    email: 'support@anynote.app',
    sameAs: [] as readonly string[],
  },
} as const

export const siteDisplayHost = siteConfig.url.replace(/^https?:\/\//, '')

export type SiteConfig = typeof siteConfig
