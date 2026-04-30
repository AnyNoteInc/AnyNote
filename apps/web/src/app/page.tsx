import type { Metadata } from 'next'

import { PublicFooter } from '@/components/public/public-footer'
import { PublicHeader } from '@/components/public/public-header'
import { getSession } from '@/lib/get-session'

import { HomeHero } from '@/components/public/home/home-hero'
import { HomeMarketFit } from '@/components/public/home/home-market-fit'
import { HomeModes } from '@/components/public/home/home-modes'
import { HomeSearch } from '@/components/public/home/home-search'
import { HomeFeatures } from '@/components/public/home/home-features'
import { HomePricing } from '@/components/public/home/home-pricing'
import { HomeContact } from '@/components/public/home/home-contact'
import { HomeFinalCta } from '@/components/public/home/home-final-cta'

export const metadata: Metadata = {
  title: 'Любые заметки — рабочая память команды',
}

export default async function HomePage() {
  const session = await getSession()
  const primaryHref = session ? '/app' : '/registration'
  const primaryLabel = session ? 'Открыть рабочее пространство' : 'Начать бесплатно'

  return (
    <>
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
    </>
  )
}
