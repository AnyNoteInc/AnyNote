'use client'

import { useState } from 'react'

import {
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  NotificationsActiveIcon,
  NotificationsNoneIcon,
  Popover,
  Radio,
  RadioGroup,
  Stack,
  Tooltip,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

const OFFSET_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: 'В момент' },
  { value: 60, label: 'За 1 час' },
  { value: 1440, label: 'За 1 день' },
]

/**
 * Self-targeted reminder affordance for a DATE cell. The bell is filled once the
 * caller has a reminder configured for this (pageId, propertyId, rowId). Setting
 * it picks an offset; clearing removes the config + its pending deliveries. All
 * writes are self-targeted server-side — there is no recipient choice here.
 */
export function DateReminderPopover({
  pageId,
  rowId,
  propertyId,
}: {
  readonly pageId: string
  readonly rowId: string
  readonly propertyId: string
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = Boolean(anchor)
  const utils = trpc.useUtils()

  const target = { pageId, rowId, propertyId }
  const reminderQ = trpc.database.getDatabaseDateReminder.useQuery(target)
  const hasReminder = Boolean(reminderQ.data)
  const currentOffset = reminderQ.data?.offsetMinutes ?? null

  const invalidate = () => utils.database.getDatabaseDateReminder.invalidate(target)

  const setReminder = trpc.database.setDatabaseDateReminder.useMutation({
    onSuccess: () => {
      void invalidate()
      setAnchor(null)
    },
  })
  const clearReminder = trpc.database.clearDatabaseDateReminder.useMutation({
    onSuccess: () => {
      void invalidate()
      setAnchor(null)
    },
  })

  const pending = setReminder.isPending || clearReminder.isPending

  const choose = (offsetMinutes: number) => {
    setReminder.mutate({ ...target, offsetMinutes })
  }

  return (
    <>
      <Tooltip title={hasReminder ? 'Напоминание установлено' : 'Напомнить'}>
        <IconButton
          size="small"
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label="Напоминание"
          aria-pressed={hasReminder}
          sx={{ color: hasReminder ? 'primary.main' : 'text.secondary' }}
        >
          {hasReminder ? (
            <NotificationsActiveIcon sx={{ fontSize: 18 }} />
          ) : (
            <NotificationsNoneIcon sx={{ fontSize: 18 }} />
          )}
        </IconButton>
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.5, width: 220 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Напоминание
          </Typography>

          {reminderQ.isLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={18} />
            </Box>
          ) : (
            <Stack spacing={1}>
              <FormControl disabled={pending}>
                <FormLabel sx={{ mb: 0.5, fontSize: 13 }}>Напомнить мне</FormLabel>
                <RadioGroup
                  value={hasReminder ? String(currentOffset) : ''}
                  onChange={(_, v) => choose(Number(v))}
                >
                  {OFFSET_PRESETS.map((o) => (
                    <FormControlLabel
                      key={o.value}
                      value={String(o.value)}
                      control={<Radio size="small" />}
                      label={o.label}
                      slotProps={{ typography: { variant: 'body2' } }}
                    />
                  ))}
                </RadioGroup>
              </FormControl>

              {hasReminder ? (
                <>
                  <Divider />
                  <Button
                    size="small"
                    color="error"
                    disabled={pending}
                    onClick={() => clearReminder.mutate(target)}
                  >
                    Убрать напоминание
                  </Button>
                </>
              ) : null}
            </Stack>
          )}
        </Box>
      </Popover>
    </>
  )
}
