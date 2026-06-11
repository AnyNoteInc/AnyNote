import Doc from '@docs/developers/api.md'

import { DevelopersArticle } from '@/components/developers/developers-shell'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

export const metadata = buildMetadata({
  title: 'REST API',
  path: '/developers/api',
  description:
    'Справочник REST API v1 AnyNote: аутентификация по API-ключам, эндпоинты для страниц, файлов и поиска, примеры запросов на curl и JavaScript.',
  keywords: ['anynote rest api', 'api-ключи', 'эндпоинты', 'справочник api'],
})

export default function DevelopersApiPage() {
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'Разработчикам', url: `${siteConfig.url}/developers` },
    { name: 'REST API', url: `${siteConfig.url}/developers/api` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <DevelopersArticle
        title="REST API"
        description="Программный доступ к страницам, файлам и поиску: аутентификация, справочник эндпоинтов v1 и примеры запросов."
      >
        <Doc />
      </DevelopersArticle>
    </>
  )
}
