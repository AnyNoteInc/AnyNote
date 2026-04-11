"use client"

import { Box, Stack, Typography } from "@repo/ui/components"

export function WorkspaceAiPanel() {
  return (
    <Box
      component="aside"
      sx={{
        borderLeft: "1px solid #1e2024",
        display: "flex",
        flexDirection: "column",
        p: 1.75,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" sx={{ color: "#a7aab1" }}>
          ✨ AI assistant
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" sx={{ color: "#6b6e75" }}>
          ⋯
        </Typography>
      </Stack>

      <Box sx={{ flex: 1 }} />

      <Stack alignItems="center" spacing={1} sx={{ textAlign: "center", pb: 1.25 }}>
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "linear-gradient(135deg,#9c7bff,#4a9eff)",
          }}
        />
        <Typography variant="body2" fontWeight={600} sx={{ color: "#f0f1f3" }}>
          Hi, I&apos;m Ani
        </Typography>
        <Typography variant="caption" sx={{ color: "#6b6e75" }}>
          Your AnyNote research assistant
        </Typography>
      </Stack>

      <Box
        sx={{ border: "1px solid #2a2d33", borderRadius: 1, backgroundColor: "#121418", p: 1.25 }}
      >
        <Typography variant="body2" sx={{ color: "#6b6e75" }}>
          Summarize my notes from last week...
        </Typography>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{ pt: 1.25, mt: 1, borderTop: "1px solid #1e2024" }}
        >
          <Typography variant="caption" sx={{ color: "#a7aab1" }}>
            Auto mode ⌄
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Box
            sx={{
              width: 22,
              height: 22,
              borderRadius: 0.625,
              backgroundColor: "#4a9eff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
            }}
          >
            ↑
          </Box>
        </Stack>
      </Box>
    </Box>
  )
}
