import { createTheme } from "@mui/material/styles"
import type { PaletteMode } from "@mui/material"

export function createAppTheme(mode: PaletteMode = "light") {
  return createTheme({
    palette: {
      mode,
      primary: {
        main: "#0f766e",
      },
      secondary: {
        main: "#155e75",
      },
      background:
        mode === "dark"
          ? {
              default: "#0a1418",
              paper: "#101c21",
            }
          : {
              default: "#eef3f1",
              paper: "#f7faf8",
            },
    },
    shape: {
      borderRadius: 4,
    },
    typography: {
      fontFamily: [
        "var(--font-geist-sans)",
        "system-ui",
        "-apple-system",
        "BlinkMacSystemFont",
        "sans-serif",
      ].join(", "),
      h1: {
        fontWeight: 800,
        letterSpacing: "-0.06em",
        lineHeight: 1.02,
      },
      h2: {
        fontWeight: 800,
        letterSpacing: "-0.05em",
        lineHeight: 1.05,
      },
      h3: {
        fontWeight: 750,
        letterSpacing: "-0.04em",
      },
      overline: {
        fontFamily: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "monospace"].join(
          ", ",
        ),
        letterSpacing: "0.16em",
        fontWeight: 700,
      },
      button: {
        textTransform: "none",
        fontWeight: 700,
      },
    },
    components: {
      MuiButton: {
        defaultProps: {
          variant: "contained",
        },
        styleOverrides: {
          root: {
            borderRadius: 4,
            paddingInline: 18,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },
    },
  })
}
