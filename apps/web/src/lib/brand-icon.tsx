import type { CSSProperties, ReactElement } from "react"

/**
 * Scale-agnostic markup for the brand icon used by both `/icon` and `/apple-icon`.
 * All measurements are expressed as a fraction of `canvasSize` so the same artwork
 * can render at any output size without manual coordinate editing.
 */
export function renderBrandIconArt(canvasSize: number): ReactElement {
  const unit = canvasSize / 512
  const radius = 120 * unit
  const borderWidth = 8 * unit

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#121416",
    borderRadius: `${radius}px`,
    border: `${borderWidth}px solid rgba(255,255,255,0.08)`,
    position: "relative",
    overflow: "hidden",
  }

  const glowStyle: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: "radial-gradient(circle at 50% 18%, rgba(255,255,255,0.10), transparent 28%)",
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
    position: "absolute",
    width: `${36 * unit}px`,
    height: `${308 * unit}px`,
    borderRadius: "999px",
    background: "#A67C52",
    top: `${104 * unit}px`,
    left: `${238 * unit}px`,
  }

  const notchStyle: CSSProperties = {
    position: "absolute",
    width: `${68 * unit}px`,
    height: `${120 * unit}px`,
    background: "#121416",
    top: `${206 * unit}px`,
    left: `${222 * unit}px`,
    clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
  }

  return (
    <div style={containerStyle}>
      <div style={glowStyle} />
      <div style={triangleStyle} />
      <div style={barStyle} />
      <div style={notchStyle} />
    </div>
  )
}
