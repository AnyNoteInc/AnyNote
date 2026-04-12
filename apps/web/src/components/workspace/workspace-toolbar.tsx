import { Box, Stack, Typography } from "@repo/ui/components"

type Breadcrumb = { label: string; href?: string }

type Props = {
  breadcrumbs: Breadcrumb[]
}

export function WorkspaceToolbar({ breadcrumbs }: Props) {
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
      {breadcrumbs.map((crumb, i) => (
        <Stack key={i} direction="row" alignItems="center" spacing={1.25}>
          {i > 0 && (
            <Typography variant="body2" color="text.disabled">
              /
            </Typography>
          )}
          <Typography
            variant="body2"
            noWrap
            color={i === breadcrumbs.length - 1 ? "text.primary" : "text.secondary"}
          >
            {crumb.label}
          </Typography>
        </Stack>
      ))}
      <Box sx={{ flex: 1 }} />
    </Stack>
  )
}
