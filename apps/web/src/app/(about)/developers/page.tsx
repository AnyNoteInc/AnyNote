import Doc from '@docs/developers/overview.md'

import { DevelopersArticle } from '@/components/developers/developers-shell'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

export const metadata = buildMetadata({
  title: 'Разработчикам',
  path: '/developers',
  description:
    'Документация AnyNote для разработчиков: REST API, исходящие вебхуки и интеграция с Телеграм. Быстрый старт с API-ключами и план развития платформы.',
  keywords: ['anynote api', 'rest api', 'вебхуки', 'интеграции', 'документация для разработчиков'],
})

export default function DevelopersOverviewPage() {
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'Разработчикам', url: `${siteConfig.url}/developers` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <DevelopersArticle
        title="Платформа для разработчиков"
        description="REST API, вебхуки и интеграция с Телеграм: подключайте AnyNote к своим сервисам и автоматизируйте работу пространства."
      >
        <Doc />
      </DevelopersArticle>
    </>
  )
}
