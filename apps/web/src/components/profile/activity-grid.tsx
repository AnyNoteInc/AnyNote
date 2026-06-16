'use client'

import { Box, Tooltip, Typography } from '@repo/ui/components'

type Day = { date: string; count: number }

function bucketColor(count: number): string {
  if (count === 0) return 'action.hover'
  if (count <= 2) return 'success.light'
  if (count <= 5) return 'success.main'
  return 'success.dark'
}

export function ActivityGrid({ grid }: { grid: Day[] }) {
  const counts = new Map(grid.map((d) => [d.date, d.count]))
  // Build the trailing 53 weeks ending today, aligned to week columns.
  const cells: Day[] = []
  const today = new Date()
  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 7 * 52 - today.getUTCDay())
  for (let i = 0; i < 53 * 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const iso = d.toISOString().slice(0, 10)
    cells.push({ date: iso, count: counts.get(iso) ?? 0 })
  }
  const weeks: Day[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="overline" color="text.secondary">
        Активность
      </Typography>
      <Box sx={{ display: 'flex', gap: '3px', mt: 1, overflowX: 'auto', pb: 1 }}>
        {weeks.map((week, wi) => (
          <Box key={wi} sx={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {week.map((day) => (
              <Tooltip key={day.date} title={`${day.date}: ${day.count}`} arrow>
                <Box
                  sx={{
                    width: 11,
                    height: 11,
                    borderRadius: '2px',
                    bgcolor: bucketColor(day.count),
                  }}
                />
              </Tooltip>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
