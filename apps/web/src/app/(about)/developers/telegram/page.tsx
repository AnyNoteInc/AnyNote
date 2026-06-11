import Doc from '@docs/developers/telegram.md'

import { DevelopersArticle } from '@/components/developers/developers-shell'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

export const metadata = buildMetadata({
  title: 'Интеграция с Телеграм',
  path: '/developers/telegram',
  description:
    'Подключение собственного Телеграм-бота к пространству AnyNote: уведомления командных разделов в чаты, привязка аккаунта, команды /search и /get, права и приватность.',
  keywords: ['anynote телеграм', 'telegram бот', 'уведомления в телеграм', 'интеграция'],
})

export default function DevelopersTelegramPage() {
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'Разработчикам', url: `${siteConfig.url}/developers` },
    { name: 'Интеграция с Телеграм', url: `${siteConfig.url}/developers/telegram` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <DevelopersArticle
        title="Интеграция с Телеграм"
        description="Собственный бот для уведомлений в чаты и команд поиска: настройка администратором, привязка аккаунтов и приватность."
      >
        <Doc />
      </DevelopersArticle>
    </>
  )
}
