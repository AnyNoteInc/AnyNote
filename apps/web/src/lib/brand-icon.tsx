import type { CSSProperties, ReactElement } from 'react'

/**
 * Scale-agnostic markup for the brand icon used by both `/icon` and `/apple-icon`.
 * Matches the orange rhombus in `public/favicon.svg` and `public/logo.svg`.
 */
export function renderBrandIconArt(canvasSize: number): ReactElement {
  const unit = canvasSize / 64
  const side = 39.6 * unit

  const containerStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
  }

  const diamondStyle: CSSProperties = {
    width: `${side}px`,
    height: `${side}px`,
    background: 'linear-gradient(135deg, #d97757, #b8512f)',
    transform: 'rotate(45deg)',
  }

  return (
    <div style={containerStyle}>
      <div style={diamondStyle} />
    </div>
  )
}
