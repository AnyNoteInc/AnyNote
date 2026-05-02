import { Box } from '@mui/material'

export type BrandIconProps = {
  size?: number
}

export function BrandIcon({ size = 56 }: BrandIconProps) {
  return (
    <Box
      role="img"
      aria-label="AnyNote"
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        background: 'linear-gradient(135deg, #d97757, #b8512f)',
        clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
        boxShadow: '6px 8px 24px rgba(0,0,0,0.14)',
      }}
    />
  )
}
