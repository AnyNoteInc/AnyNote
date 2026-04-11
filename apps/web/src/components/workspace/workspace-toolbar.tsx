import { Box, Stack, Typography } from "@repo/ui/components"

type Props = {
  pageTitle: string
  pageIcon?: string | null
  editedLabel: string
}

export function WorkspaceToolbar({ pageTitle, pageIcon, editedLabel }: Props) {
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1.25}
      sx={{
        px: 2,
        py: 1.25,
        borderBottom: "1px solid",
        borderColor: "divider",
      }}
    >
      <Typography variant="body2" noWrap>
        {pageIcon ? `${pageIcon} ` : ""}
        {pageTitle}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        ·
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Private
      </Typography>
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.secondary">
        {editedLabel}
      </Typography>
    </Stack>
  )
}
