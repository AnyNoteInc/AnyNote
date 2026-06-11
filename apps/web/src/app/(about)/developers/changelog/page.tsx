import Doc from '@docs/developers/changelog.md'

import { DevelopersArticle } from '@/components/developers/developers-shell'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

export const metadata = buildMetadata({
  title: 'Изменения API',
  path: '/developers/changelog',
  description:
    'Версионирование REST API и вебхуков AnyNote, политика устаревания и журнал изменений платформы для разработчиков.',
  keywords: ['anynote api changelog', 'версионирование api', 'политика устаревания'],
})

export default function DevelopersChangelogPage() {
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'Разработчикам', url: `${siteConfig.url}/developers` },
    { name: 'Изменения API', url: `${siteConfig.url}/developers/changelog` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <DevelopersArticle
        title="Изменения API"
        description="Версионирование, политика устаревания и журнал изменений REST API, вебхуков и интеграции с Телеграм."
      >
        <Doc />
      </DevelopersArticle>
    </>
  )
}
