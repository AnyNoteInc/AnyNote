import type { CSSProperties } from "react"
import type { RenderableLabel } from "../../types"

export interface PersonLabelProps {
  label: RenderableLabel
  shapeWidth: number
  shapeHeight: number
}

const GAP = 8

export function PersonLabel({ label, shapeWidth, shapeHeight }: PersonLabelProps) {
  if (label.hidden || label.lines.length === 0) return null

  const style: CSSProperties = {
    position: "absolute",
    fontSize: 10,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    pointerEvents: "none",
    color: "var(--genogram-text, #333)",
  }

  switch (label.position) {
    case "left":
      style.right = shapeWidth + GAP
      style.top = "50%"
      style.transform = "translateY(-50%)"
      style.textAlign = "right"
      break
    case "right":
      style.left = shapeWidth + GAP
      style.top = "50%"
      style.transform = "translateY(-50%)"
      style.textAlign = "left"
      break
    case "top":
      style.bottom = shapeHeight + GAP / 2
      style.left = "50%"
      style.transform = "translateX(-50%)"
      style.textAlign = "center"
      break
    case "bottom":
    default:
      style.top = shapeHeight + GAP / 2
      style.left = "50%"
      style.transform = "translateX(-50%)"
      style.textAlign = "center"
  }

  if (label.offset) {
    const existingTransform = style.transform ?? ""
    style.transform = `${existingTransform} translate(${label.offset.x}px, ${label.offset.y}px)`.trim()
  }

  return (
    <div style={style}>
      {label.lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  )
}
