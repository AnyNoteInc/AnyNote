import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import localFont from 'next/font/local'
import { Lora } from 'next/font/google'

import { UiProvider } from '@repo/ui/providers'

import { getSession } from '@/lib/get-session'
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

export const metadata: Metadata = {
  title: 'Любые заметки',
  description:
    'Рабочая память команды с ИИ-поиском. Документы, схемы и заметки в одном пространстве.',
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
    <html lang="ru" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} ${lora.variable}`}>
        <UiProvider initial={mode}>{children}</UiProvider>
      </body>
    </html>
  )
}
