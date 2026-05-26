import Changelog from '@docs/changelog.md'

import { PublicPageShell } from '@/components/public/public-page-shell'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { breadcrumbsSchema } from '@/lib/seo/schemas/breadcrumbs'
import { siteConfig } from '@/lib/seo/site-config'

export const metadata = buildMetadata({
  title: 'История изменений',
  path: '/changelog',
  description:
    'Что нового в «Любые заметки»: новые возможности редактора, ИИ-агент, канбан-доски, совместная работа, уведомления и публикация страниц.',
  keywords: ['история изменений', 'обновления', 'changelog заметки'],
})

export default function ChangelogPage() {
  const crumbs = breadcrumbsSchema([
    { name: 'Главная', url: `${siteConfig.url}/` },
    { name: 'История изменений', url: `${siteConfig.url}/changelog` },
  ])
  return (
    <>
      <JsonLd data={crumbs} />
      <PublicPageShell
        eyebrow="Обновления"
        title="История изменений"
        description="Коротко о том, что менялось в продукте: новые возможности и заметные улучшения, свежее — сверху."
      >
        <Changelog />
      </PublicPageShell>
    </>
  )
}
