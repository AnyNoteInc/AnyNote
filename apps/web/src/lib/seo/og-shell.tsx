import type { ReactNode } from 'react'

import { siteConfig, siteDisplayHost } from './site-config'

export const OG_SIZE = { width: 1200, height: 630 } as const

type OgShellProps = {
  background: string
  children: ReactNode
  showFooter?: boolean
}

export function OgShell({ background, children, showFooter = true }: Readonly<OgShellProps>) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 80,
        background,
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {children}
      {showFooter ? (
        <div style={{ fontSize: 22, marginTop: 56, opacity: 0.7, display: 'flex' }}>
          {siteConfig.brandRu} · {siteDisplayHost}
        </div>
      ) : null}
    </div>
  )
}
