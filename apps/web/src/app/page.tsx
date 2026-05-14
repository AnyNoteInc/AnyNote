import { PublicFooter } from '@/components/public/public-footer'
import { PublicHeader } from '@/components/public/public-header'
import { CookieBanner } from '@/components/public/cookie-banner'
import { getSession } from '@/lib/get-session'
import { buildMetadata } from '@/lib/seo/build-metadata'
import { JsonLd } from '@/lib/seo/json-ld'
import { organizationSchema } from '@/lib/seo/schemas/organization'
import { softwareAppSchema } from '@/lib/seo/schemas/software-app'
import { websiteSchema } from '@/lib/seo/schemas/website'
import { siteConfig } from '@/lib/seo/site-config'

import { HomeHero } from '@/components/public/home/home-hero'
import { HomeMarketFit } from '@/components/public/home/home-market-fit'
import { HomeModes } from '@/components/public/home/home-modes'
import { HomeSearch } from '@/components/public/home/home-search'
import { HomeFeatures } from '@/components/public/home/home-features'
import { HomePricing } from '@/components/public/home/home-pricing'
import { HomeContact } from '@/components/public/home/home-contact'
import { HomeFinalCta } from '@/components/public/home/home-final-cta'

export const metadata = buildMetadata({
  title: 'Любые заметки — рабочая память команды с ИИ-поиском',
  path: '/',
  ogImage: `${siteConfig.url}/opengraph-image`,
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

  return (
    <>
      {/* Explicit canonical with trailing slash — Next.js strips it from alternates.canonical for root paths */}
      <link rel="canonical" href={`${siteConfig.url}/`} />
      <JsonLd data={[organizationSchema(), websiteSchema(), softwareAppSchema()]} />
      <PublicHeader session={session} />
      <main>
        <HomeHero primaryHref={primaryHref} primaryLabel={primaryLabel} showSecondary={!session} />
        <HomeMarketFit />
        <HomeModes />
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
