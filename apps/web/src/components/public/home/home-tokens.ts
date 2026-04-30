export const homeTokens = {
  palette: {
    paper: '#faf9f5',
    paperDeep: '#f0eee6',
    ink: '#1d1d1b',
    inkSoft: 'rgba(29,29,27,0.65)',
    inkMute: 'rgba(29,29,27,0.42)',
    orange: '#c96442',
    orangeWarm: '#d97757',
    line: 'rgba(0,0,0,0.08)',
  },
  fonts: {
    serif: 'var(--font-serif), "Charter", Georgia, "Times New Roman", serif',
    mono: 'var(--font-geist-mono), ui-monospace, "SF Mono", monospace',
    sans: 'var(--font-geist-sans), system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  keyframes: {
    heroIn: {
      from: { opacity: 0, transform: 'translateY(18px)' },
      to: { opacity: 1, transform: 'translateY(0)' },
    },
    surfaceFloat: {
      '0%, 100%': { transform: 'translateY(0)' },
      '50%': { transform: 'translateY(-10px)' },
    },
    scan: {
      from: { transform: 'translateX(-30%)', opacity: 0.2 },
      to: { transform: 'translateX(130%)', opacity: 0 },
    },
  },
} as const

export const homeBaseSx = {
  '@keyframes anHeroIn': homeTokens.keyframes.heroIn,
  '@keyframes anSurfaceFloat': homeTokens.keyframes.surfaceFloat,
  '@keyframes anScan': homeTokens.keyframes.scan,
} as const

export const eyebrowSx = {
  fontFamily: homeTokens.fonts.mono,
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  color: homeTokens.palette.inkMute,
}

export const sectionTitleSx = {
  fontFamily: homeTokens.fonts.serif,
  fontWeight: 500,
  fontSize: { xs: '2rem', md: '2.75rem' },
  lineHeight: 1.05,
  letterSpacing: '-0.02em',
  color: homeTokens.palette.ink,
  m: 0,
  maxWidth: 780,
  '& em': { fontStyle: 'italic', color: homeTokens.palette.orange },
}
