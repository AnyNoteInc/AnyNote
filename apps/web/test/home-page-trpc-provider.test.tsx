// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/trpc/client', () => ({
  TRPCReactProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="homepage-trpc-provider">{children}</div>
  ),
}))

vi.mock('@/lib/get-session', () => ({
  getSession: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/seo/build-metadata', () => ({
  buildMetadata: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/seo/json-ld', () => ({
  JsonLd: () => null,
}))

vi.mock('@/lib/seo/schemas/organization', () => ({
  organizationSchema: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/seo/schemas/software-app', () => ({
  softwareAppSchema: vi.fn().mockReturnValue({}),
}))

vi.mock('@/lib/seo/schemas/website', () => ({
  websiteSchema: vi.fn().mockReturnValue({}),
}))

vi.mock('@/components/public/public-footer', () => ({
  PublicFooter: () => <div data-testid="public-footer" />,
}))

vi.mock('@/components/public/public-header', () => ({
  PublicHeader: () => <div data-testid="public-header" />,
}))

vi.mock('@/components/public/cookie-banner', () => ({
  CookieBanner: () => <div data-testid="cookie-banner" />,
}))

vi.mock('@/components/analytics/yandex-metrica', () => ({
  YandexMetrica: () => null,
}))

vi.mock('@/components/public/home/home-hero', () => ({
  HomeHero: () => <div data-testid="home-content" />,
}))

vi.mock('@/components/public/home/home-market-fit', () => ({ HomeMarketFit: () => null }))
vi.mock('@/components/public/home/home-modes', () => ({ HomeModes: () => null }))
vi.mock('@/components/public/home/home-capabilities', () => ({ HomeCapabilities: () => null }))
vi.mock('@/components/public/home/home-search', () => ({ HomeSearch: () => null }))
vi.mock('@/components/public/home/home-features', () => ({ HomeFeatures: () => null }))
vi.mock('@/components/public/home/home-open-source', () => ({ HomeOpenSource: () => null }))
vi.mock('@/components/public/home/home-pricing', () => ({ HomePricing: () => null }))
vi.mock('@/components/public/home/home-contact', () => ({ HomeContact: () => null }))
vi.mock('@/components/public/home/home-final-cta', () => ({ HomeFinalCta: () => null }))

import HomePage from '@/app/page'

afterEach(() => {
  cleanup()
})

describe('HomePage', () => {
  it('renders the homepage inside the tRPC provider', async () => {
    render(await HomePage())

    expect(screen.getByTestId('homepage-trpc-provider')).toContainElement(
      screen.getByTestId('home-content'),
    )
  })
})
