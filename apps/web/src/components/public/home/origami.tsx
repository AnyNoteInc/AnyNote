import type { CSSProperties } from 'react'
import { Box } from '@repo/ui/components'

import { homeTokens } from './home-tokens'

type Variant = 'rhombus' | 'triangle' | 'circle'

const clipPaths: Record<Variant, string | undefined> = {
  rhombus: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  triangle: 'polygon(50% 0%, 100% 100%, 0% 100%)',
  circle: undefined,
}

const gradients = {
  warm: `linear-gradient(135deg, ${homeTokens.palette.orangeWarm}, #b8512f)`,
  deep: `linear-gradient(135deg, ${homeTokens.palette.orange}, #8a3f25)`,
  ink: homeTokens.palette.ink,
} as const

type Props = {
  variant: Variant
  size: number
  gradient?: keyof typeof gradients
  rotate?: number
  style?: CSSProperties
  ariaHidden?: boolean
}

export function Origami({
  variant,
  size,
  gradient = 'warm',
  rotate = 0,
  style,
  ariaHidden = true,
}: Props) {
  return (
    <Box
      aria-hidden={ariaHidden}
      sx={{
        position: 'absolute',
        width: size,
        height: size,
        background: gradients[gradient],
        clipPath: clipPaths[variant],
        borderRadius: variant === 'circle' ? '50%' : 0,
        boxShadow:
          variant === 'circle'
            ? '4px 6px 16px rgba(0,0,0,0.18)'
            : '6px 8px 24px rgba(0,0,0,0.14)',
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        '@media (prefers-reduced-motion: reduce)': { transform: 'none' },
        ...style,
      }}
    />
  )
}
