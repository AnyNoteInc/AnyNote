import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import localFont from 'next/font/local'
import { Lora } from 'next/font/google'

import { UiProvider } from '@repo/ui/providers'

import { getSession } from '@/lib/get-session'
import { PWA_THEME_COLOR } from '@/lib/pwa'
import { siteConfig } from '@/lib/seo/site-config'
import { getServerTRPC } from '@/trpc/server'

import './globals.css'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
})

const lora = Lora({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-serif',
  display: 'swap',
})

export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
}

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.brandRu,
    template: `%s · ${siteConfig.brandRu}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  verification: {
    yandex: process.env.YANDEX_VERIFICATION,
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon', type: 'image/png', sizes: '512x512' },
      { url: '/favicon.ico', sizes: 'any' },
    ],
    apple: [{ url: '/apple-icon', type: 'image/png', sizes: '180x180' }],
    shortcut: ['/icon'],
  },
}

async function resolveTheme(): Promise<'light' | 'dark' | 'system'> {
  const cookieStore = await cookies()
  const cookieTheme = cookieStore.get('theme')?.value as 'light' | 'dark' | 'system' | undefined

  const session = await getSession()
  if (session) {
    try {
      const trpc = await getServerTRPC()
      const prefs = await trpc.user.getPreferences()
      const stored = (prefs?.theme as 'light' | 'dark' | 'system' | null) ?? cookieTheme ?? 'system'
      return stored
    } catch {
      // fall through
    }
  }

  return cookieTheme ?? 'system'
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const mode = await resolveTheme()
  return (
    <html lang="ru" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} ${lora.variable}`}>
        <UiProvider initial={mode}>{children}</UiProvider>
      </body>
    </html>
  )
}
