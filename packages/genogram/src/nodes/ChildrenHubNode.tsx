import { Handle, Position } from "@xyflow/react"

export function ChildrenHubNode() {
  return (
    <div style={anchorStyle}>
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={handleStyle}
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={handleStyle}
        isConnectable={false}
      />
    </div>
  )
}

const anchorStyle = {
  width: 1,
  height: 1,
  pointerEvents: "none" as const,
}

const handleStyle = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
  border: 0,
  background: "transparent",
}
