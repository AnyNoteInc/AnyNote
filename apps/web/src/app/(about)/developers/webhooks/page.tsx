import Doc from '@docs/developers/webhooks.md'

import { DevelopersArticle } from '@/components/developers/developers-shell'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

export const metadata = buildMetadata({
  title: 'Вебхуки',
  path: '/developers/webhooks',
  description:
    'Исходящие вебхуки AnyNote: каталог событий, конверт payload v1, проверка HMAC-подписи, верификация адреса, повторные попытки и требования безопасности.',
  keywords: ['anynote вебхуки', 'webhooks', 'hmac подпись', 'события пространства'],
})

export default function DevelopersWebhooksPage() {
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'Разработчикам', url: `${siteConfig.url}/developers` },
    { name: 'Вебхуки', url: `${siteConfig.url}/developers/webhooks` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <DevelopersArticle
        title="Вебхуки"
        description="Исходящие HTTP-уведомления о событиях пространства: каталог событий, формат конверта, подпись и политика повторов."
      >
        <Doc />
      </DevelopersArticle>
    </>
  )
}
