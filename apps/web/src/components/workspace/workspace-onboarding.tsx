import { Box, Stack, Typography } from "@repo/ui/components"

type Item =
  | { kind: "check"; done: boolean; text: React.ReactNode }
  | { kind: "toggle"; text: React.ReactNode }

function SlashPill({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        color: "#9c7bff",
        backgroundColor: "#1a1824",
        px: 0.75,
        py: 0.25,
        borderRadius: 0.5,
        fontFamily: "monospace",
        fontSize: "0.9em",
      }}
    >
      {children}
    </Box>
  )
}

const items: Item[] = [
  { kind: "check", done: true, text: "Create your first page" },
  { kind: "check", done: true, text: "Pick a workspace icon" },
  { kind: "check", done: false, text: <>Try a slash command — type <SlashPill>/heading</SlashPill> on a blank line</> },
  { kind: "check", done: false, text: "Import notes from Notion or Obsidian" },
  { kind: "check", done: false, text: "Upload a file or image with drag-and-drop" },
  { kind: "check", done: false, text: "Connect an integration (GitHub, Telegram, AmoCRM)" },
  { kind: "toggle", text: "Advanced: databases, views, filters" },
  { kind: "check", done: false, text: "Share a page with a public link" },
  { kind: "check", done: false, text: <>Ask AI about your docs — <SlashPill>/ask</SlashPill></> },
  { kind: "check", done: false, text: "Invite a teammate" },
]

export function WorkspaceOnboarding() {
  return (
    <Box
      component="main"
      sx={{
        flex: 1,
        overflow: "auto",
        display: "flex",
        justifyContent: "center",
        pt: { xs: 6, md: 10 },
        px: { xs: 3, md: 6 },
        pb: 6,
      }}
    >
      <Box sx={{ maxWidth: 480, width: "100%" }}>
        <Typography sx={{ fontSize: 40, lineHeight: 1, mb: 2.25 }}>👋</Typography>
        <Typography
          variant="h3"
          fontWeight={700}
          letterSpacing="-0.02em"
          sx={{ mb: 2.5, color: "#f0f1f3" }}
        >
          Welcome to AnyNote
        </Typography>
        <Stack spacing={1.25}>
          {items.map((item, idx) => (
            <Stack key={idx} direction="row" spacing={1.25} alignItems="center">
              {item.kind === "check" && (
                <Box component="span" sx={{ color: item.done ? "#4a9eff" : "#4a4d55", fontSize: 16 }}>
                  {item.done ? "☑" : "☐"}
                </Box>
              )}
              {item.kind === "toggle" && (
                <Box component="span" sx={{ color: "#6b6e75", fontSize: 16 }}>▸</Box>
              )}
              <Typography
                variant="body2"
                sx={{
                  color: item.kind === "check" && item.done ? "#6b6e75" : "#e7e8ea",
                  textDecoration: item.kind === "check" && item.done ? "line-through" : "none",
                }}
              >
                {item.text}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>
    </Box>
  )
}
