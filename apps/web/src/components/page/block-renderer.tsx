import type { Block } from "@repo/db"

import { Box, Checkbox, Typography } from "@repo/ui/components"

type BlockContent = {
  text?: string
  checked?: boolean
  emoji?: string
  language?: string
}

export function BlockRenderer({ block }: { block: Block & { depth: number } }) {
  const content = (block.content ?? {}) as BlockContent
  const indent = block.depth * 24

  switch (block.type) {
    case "PARAGRAPH":
      return (
        <Typography sx={{ pl: `${indent}px`, my: 0.75 }}>{content.text}</Typography>
      )
    case "HEADING_1":
      return (
        <Typography variant="h3" sx={{ pl: `${indent}px`, mt: 3, mb: 1 }}>
          {content.text}
        </Typography>
      )
    case "HEADING_2":
      return (
        <Typography variant="h4" sx={{ pl: `${indent}px`, mt: 2.5, mb: 1 }}>
          {content.text}
        </Typography>
      )
    case "HEADING_3":
      return (
        <Typography variant="h5" sx={{ pl: `${indent}px`, mt: 2, mb: 0.75 }}>
          {content.text}
        </Typography>
      )
    case "TO_DO":
      return (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, pl: `${indent}px`, my: 0.25 }}>
          <Checkbox checked={!!content.checked} disabled size="small" />
          <Typography
            sx={{
              textDecoration: content.checked ? "line-through" : "none",
              color: content.checked ? "text.disabled" : "text.primary",
            }}
          >
            {content.text}
          </Typography>
        </Box>
      )
    case "BULLETED_LIST_ITEM":
      return <Typography sx={{ pl: `${indent + 16}px`, my: 0.25 }}>• {content.text}</Typography>
    case "NUMBERED_LIST_ITEM":
      return <Typography sx={{ pl: `${indent + 16}px`, my: 0.25 }}>{content.text}</Typography>
    case "TOGGLE":
      return (
        <Box component="details" sx={{ pl: `${indent}px`, my: 0.5 }}>
          <Box component="summary" sx={{ cursor: "pointer", listStyle: "none" }}>
            <Typography component="span">▸ {content.text}</Typography>
          </Box>
        </Box>
      )
    case "QUOTE":
      return (
        <Typography
          sx={{
            pl: `${indent + 12}px`,
            borderLeft: "3px solid",
            borderColor: "divider",
            my: 1,
            fontStyle: "italic",
          }}
        >
          {content.text}
        </Typography>
      )
    case "CALLOUT":
      return (
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            ml: `${indent}px`,
            my: 1,
          }}
        >
          <Typography component="span">{content.emoji ?? "💡"}</Typography>
          <Typography>{content.text}</Typography>
        </Box>
      )
    case "DIVIDER":
      return (
        <Box
          component="hr"
          sx={{
            ml: `${indent}px`,
            border: 0,
            borderTop: "1px solid",
            borderColor: "divider",
            my: 1.5,
          }}
        />
      )
    case "CODE":
      return (
        <Box
          component="pre"
          sx={{
            ml: `${indent}px`,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "action.hover",
            fontFamily: "var(--font-geist-mono)",
            fontSize: 13,
            overflowX: "auto",
          }}
        >
          {content.text}
        </Box>
      )
    default:
      return null
  }
}
