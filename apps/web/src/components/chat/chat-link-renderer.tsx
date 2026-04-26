'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function renderChatLink(href: string, children: ReactNode): ReactNode {
  // Internal app links: /workspaces/..., /app, etc. (single leading slash, not //)
  if (href.startsWith('/') && !href.startsWith('//')) {
    return <Link href={href}>{children}</Link>
  }
  // External: only render <a> for safe protocols (http/https)
  try {
    const url = new URL(href)
    if (SAFE_EXTERNAL_PROTOCOLS.has(url.protocol)) {
      return (
        <a href={href} rel="noopener noreferrer" target="_blank">
          {children}
        </a>
      )
    }
  } catch {
    // Not a valid URL — fall through
  }
  // Unsafe / unrecognized — render the label as plain text (no link)
  return <>{children}</>
}
