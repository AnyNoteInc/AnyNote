import { createTheme } from '@mui/material/styles'
import type { PaletteMode } from '@mui/material'

// Claude brand palette
const paper = '#faf9f5'
const paperDeep = '#f0eee6'
const ink = '#1d1d1b'
const inkSoft = '#2a2a27'
const orange = '#c96442'
const orangeWarm = '#d97757'

export function createAppTheme(mode: PaletteMode = 'light') {
  const isDark = mode === 'dark'
  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: { main: orange, dark: '#a04a2d', light: orangeWarm, contrastText: paper },
      secondary: { main: ink, contrastText: paper },
      background: isDark
        ? { default: ink, paper: inkSoft }
        : { default: paper, paper: '#ffffff' },
      text: isDark
        ? {
            primary: paperDeep,
            secondary: 'rgba(240,238,230,0.65)',
            disabled: 'rgba(240,238,230,0.4)',
          }
        : {
            primary: ink,
            secondary: 'rgba(29,29,27,0.65)',
            disabled: 'rgba(29,29,27,0.42)',
          },
      divider: isDark ? 'rgba(240,238,230,0.12)' : 'rgba(0,0,0,0.08)',
    },
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: [
        'var(--font-geist-sans)',
        'system-ui',
        '-apple-system',
        'BlinkMacSystemFont',
        'sans-serif',
      ].join(', '),
      fontWeightLight: 200,
      fontWeightRegular: 300,
      fontWeightMedium: 400,
      fontWeightBold: 500,
      h1: { fontWeight: 300, letterSpacing: '-0.04em', lineHeight: 1.08 },
      h2: { fontWeight: 300, letterSpacing: '-0.03em', lineHeight: 1.12 },
      h3: { fontWeight: 300, letterSpacing: '-0.02em' },
      h4: { fontWeight: 400 },
      h5: { fontWeight: 400 },
      h6: { fontWeight: 400 },
      subtitle1: { fontWeight: 400 },
      subtitle2: { fontWeight: 400 },
      body1: { fontWeight: 300 },
      body2: { fontWeight: 300 },
      button: { textTransform: 'none', fontWeight: 400 },
      overline: {
        fontFamily: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'].join(
          ', ',
        ),
        letterSpacing: '0.16em',
        fontWeight: 400,
      },
    },
    components: {
      MuiButton: {
        defaultProps: { variant: 'contained' },
        styleOverrides: {
          root: { borderRadius: 4, paddingInline: 18 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
    },
  })
}
