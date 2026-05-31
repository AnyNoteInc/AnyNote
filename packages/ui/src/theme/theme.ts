import { createTheme } from '@mui/material/styles'
import type { PaletteMode } from '@mui/material'

// Claude brand palette
const cream = '#faf9f5' // light app canvas
const paperLight = '#ffffff' // light elevated surfaces
const darkCanvas = '#262624' // dark app canvas
const darkPaper = '#2f2f2c' // dark elevated surfaces
const inkWarm = '#3d3d3a' // warm near-black for light text / dark secondary surface
const creamSoft = '#e8e4da' // warm off-white for dark text
const coral = '#bd5d3a' // coral/rust accent
const coralDark = '#9c4a2d'
const coralLight = '#d97757'

export function createAppTheme(mode: PaletteMode = 'light') {
  const isDark = mode === 'dark'
  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: { main: coral, dark: coralDark, light: coralLight, contrastText: '#ffffff' },
      secondary: { main: isDark ? creamSoft : inkWarm, contrastText: isDark ? inkWarm : cream },
      background: isDark
        ? { default: darkCanvas, paper: darkPaper }
        : { default: cream, paper: paperLight },
      text: isDark
        ? {
            primary: creamSoft,
            secondary: 'rgba(232,228,218,0.66)',
            disabled: 'rgba(232,228,218,0.4)',
          }
        : {
            primary: inkWarm,
            secondary: '#6b675e',
            disabled: 'rgba(61,61,58,0.42)',
          },
      divider: isDark ? 'rgba(232,228,218,0.12)' : 'rgba(60,50,30,0.10)',
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
