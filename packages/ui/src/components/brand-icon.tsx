import type { CSSProperties } from 'react'
import { Box } from '@mui/material'

export type BrandIconProps = {
  size?: number
}

export function BrandIcon({ size = 56 }: BrandIconProps) {
  const unit = size / 512
  const radius = 120 * unit
  const borderWidth = 8 * unit

  const containerStyle: CSSProperties = {
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#121416',
    borderRadius: radius,
    border: `${borderWidth}px solid rgba(255,255,255,0.08)`,
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
  }
  const glowStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(circle at 50% 18%, rgba(255,255,255,0.10), transparent 28%)',
  }
  const triangleStyle: CSSProperties = {
    width: 0,
    height: 0,
    borderLeft: `${96 * unit}px solid transparent`,
    borderRight: `${96 * unit}px solid transparent`,
    borderBottom: `${330 * unit}px solid #F5F0E8`,
    transform: `translateY(${-10 * unit}px)`,
  }
  const barStyle: CSSProperties = {
    position: 'absolute',
    width: 36 * unit,
    height: 308 * unit,
    borderRadius: 999,
    background: '#A67C52',
    top: 104 * unit,
    left: 238 * unit,
  }
  const notchStyle: CSSProperties = {
    position: 'absolute',
    width: 68 * unit,
    height: 120 * unit,
    background: '#121416',
    top: 206 * unit,
    left: 222 * unit,
    clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  }

  return (
    <Box style={containerStyle} role="img" aria-label="AnyNote">
      <Box style={glowStyle} />
      <Box style={triangleStyle} />
      <Box style={barStyle} />
      <Box style={notchStyle} />
    </Box>
  )
}
