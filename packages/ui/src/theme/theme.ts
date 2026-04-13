import { createTheme } from "@mui/material/styles"
import type { PaletteMode } from "@mui/material"

export function createAppTheme(mode: PaletteMode = "light") {
  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: { main: "#0f766e" },
      secondary: { main: "#155e75" },
      background:
        mode === "dark"
          ? {
              default: "#0c0d10",
              paper: "#14161a",
            }
          : {
              default: "#fafaf9",
              paper: "#ffffff",
            },
      text:
        mode === "dark"
          ? {
              primary: "#e7e8ea",
              secondary: "#a7aab1",
              disabled: "#6b6e75",
            }
          : {
              primary: "#1f2021",
              secondary: "#52525b",
              disabled: "#a1a1aa",
            },
      divider: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
    },
    shape: { borderRadius: 4 },
    typography: {
      fontFamily: [
        "var(--font-geist-sans)",
        "system-ui",
        "-apple-system",
        "BlinkMacSystemFont",
        "sans-serif",
      ].join(", "),
      fontWeightLight: 200,
      fontWeightRegular: 300,
      fontWeightMedium: 400,
      fontWeightBold: 500,
      h1: { fontWeight: 300, letterSpacing: "-0.04em", lineHeight: 1.08 },
      h2: { fontWeight: 300, letterSpacing: "-0.03em", lineHeight: 1.12 },
      h3: { fontWeight: 300, letterSpacing: "-0.02em" },
      h4: { fontWeight: 400 },
      h5: { fontWeight: 400 },
      h6: { fontWeight: 400 },
      subtitle1: { fontWeight: 400 },
      subtitle2: { fontWeight: 400 },
      body1: { fontWeight: 300 },
      body2: { fontWeight: 300 },
      button: { textTransform: "none", fontWeight: 400 },
      overline: {
        fontFamily: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"].join(
          ", ",
        ),
        letterSpacing: "0.16em",
        fontWeight: 400,
      },
    },
    components: {
      MuiButton: {
        defaultProps: { variant: "contained" },
        styleOverrides: {
          root: { borderRadius: 4, paddingInline: 18 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: "none" },
        },
      },
    },
  })
}
