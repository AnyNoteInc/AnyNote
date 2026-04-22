"use client"

import Alert from "@mui/material/Alert"
import AlertTitle from "@mui/material/AlertTitle"

import type { ChatServiceStatusPart } from "./chat-types"

type ChatServiceBlockProps = {
  part: ChatServiceStatusPart
}

function getSeverity(state: ChatServiceStatusPart["state"]) {
  switch (state) {
    case "done":
      return "success"
    case "error":
      return "error"
    case "required":
      return "warning"
    default:
      return "info"
  }
}

function getStateLabel(state: ChatServiceStatusPart["state"]) {
  switch (state) {
    case "done":
      return "Done"
    case "error":
      return "Error"
    case "required":
      return "Action required"
    case "running":
      return "Running"
    default:
      return "Pending"
  }
}

export function ChatServiceBlock({ part }: ChatServiceBlockProps) {
  return (
    <Alert severity={getSeverity(part.state)} variant="outlined">
      <AlertTitle>{`${part.kind === "tool" ? "Tool" : "Confirmation"} • ${getStateLabel(part.state)}`}</AlertTitle>
      {part.title}
      {part.detail ? ` — ${part.detail}` : null}
    </Alert>
  )
}
