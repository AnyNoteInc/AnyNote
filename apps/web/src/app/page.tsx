import type { WorkspaceSummary } from '@/components/app/app-user-menu'
import { PublicFooter } from '@/components/public/public-footer'
import { PublicHeader } from '@/components/public/public-header'
import { CookieBanner } from '@/components/public/cookie-banner'
import { getSession } from '@/lib/get-session'
import { getServerTRPC } from '@/trpc/server'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { organizationSchema } from '@/lib/seo/schemas/organization'
import { softwareAppSchema } from '@/lib/seo/schemas/software-app'
import { websiteSchema } from '@/lib/seo/schemas/website'

import { HomeHero } from '@/components/public/home/home-hero'
import { HomeMarketFit } from '@/components/public/home/home-market-fit'
import { HomeModes } from '@/components/public/home/home-modes'
import { HomeCapabilities } from '@/components/public/home/home-capabilities'
import { HomeSearch } from '@/components/public/home/home-search'
import { HomeFeatures } from '@/components/public/home/home-features'
import { HomePricing } from '@/components/public/home/home-pricing'
import { HomeContact } from '@/components/public/home/home-contact'
import { HomeFinalCta } from '@/components/public/home/home-final-cta'

export const metadata = buildMetadata({
  title: 'Любые заметки — рабочая память команды с ИИ-поиском',
  path: '/',
  keywords: [
    'заметки команды',
    'база знаний',
    'ИИ-поиск по документам',
    'wiki для команды',
    'совместное редактирование',
  ],
})

export default async function HomePage() {
  const session = await getSession()
  const primaryHref = session ? '/app' : '/registration'
  const primaryLabel = session ? 'Открыть рабочее пространство' : 'Начать бесплатно'

  let activeWorkspace: WorkspaceSummary | null = null
  let hasAnyWorkspace = false
  if (session) {
    const trpc = await getServerTRPC()
    const [ws, mine] = await Promise.all([
      trpc.workspace.getActive().catch(() => null),
      trpc.workspace.listMine().catch(() => []),
    ])
    if (ws) activeWorkspace = { name: ws.name, icon: ws.icon ?? null }
    hasAnyWorkspace = mine.length > 0
  }

  return (
    <>
      <JsonLd data={[organizationSchema(), websiteSchema(), softwareAppSchema()]} />
      <PublicHeader
        session={session}
        activeWorkspace={activeWorkspace}
        hasAnyWorkspace={hasAnyWorkspace}
      />
      <main>
        <HomeHero primaryHref={primaryHref} primaryLabel={primaryLabel} showSecondary={!session} />
        <HomeMarketFit />
        <HomeModes />
        <HomeCapabilities />
        <HomeSearch />
        <HomeFeatures />
        <HomePricing />
        <HomeContact />
        <HomeFinalCta primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>
      <PublicFooter />
      <CookieBanner />
    </>
  )
}
