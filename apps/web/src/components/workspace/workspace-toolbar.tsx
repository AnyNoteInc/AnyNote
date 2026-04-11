import { Box, Stack, Typography } from "@repo/ui/components"

type Props = {
  title: string
  editedRelative: string
}

export function WorkspaceToolbar({ title, editedRelative }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.5}
      sx={{
        px: 2.25,
        py: 1.25,
        borderBottom: "1px solid #1a1c20",
      }}
    >
      <Typography variant="body2" sx={{ color: "#a7aab1" }}>
        👋 {title}
      </Typography>
      <Typography variant="body2" sx={{ color: "#6b6e75" }}>
        ·
      </Typography>
      <Typography variant="body2" sx={{ color: "#6b6e75" }}>
        Private
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" sx={{ color: "#6b6e75" }}>
        {editedRelative}
      </Typography>
      <Typography variant="body2" sx={{ color: "#a7aab1", cursor: "default" }}>
        Share
      </Typography>
      <Typography variant="body2" sx={{ color: "#6b6e75" }}>
        ⋯
      </Typography>
      <Box
        sx={{
          px: 1.25,
          py: 0.5,
          borderRadius: 0.75,
          border: "1px solid #2a2d33",
          backgroundColor: "#1a1c20",
          fontSize: 12,
          color: "#a7aab1",
        }}
      >
        ＋ New AI chat
      </Box>
    </Stack>
  )
}
