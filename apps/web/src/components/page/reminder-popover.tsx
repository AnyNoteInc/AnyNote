'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AdapterDateFns,
  Box,
  Button,
  Checkbox,
  CloseIcon,
  DateTimePicker,
  DeleteIcon,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  LocalizationProvider,
  Popover,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
  dateFnsRu,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

type Audience = 'ME' | 'WORKSPACE' | 'LIST'

export type ReminderFormValue = {
  id: string
  dueAt: string | null
  offsets: number[]
  audience: Audience
  label: string | null
  recipients: string[]
  doneAt: string | null
}

const OFFSET_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: 'В момент истечения' },
  { value: 60, label: 'За 1 час' },
  { value: 1440, label: 'За 1 день' },
  { value: 4320, label: 'За 3 дня' },
  { value: 10080, label: 'За 1 неделю' },
  { value: 43200, label: 'За 1 месяц' },
]

type Props = Readonly<{
  open: boolean
  anchorEl: HTMLElement | null
  mode: 'create' | 'edit'
  initial: ReminderFormValue
  workspaceId: string
  readOnly?: boolean
  onClose: () => void
  onSave: (value: ReminderFormValue) => void
  onDelete?: () => void
}>

export function ReminderPopover({
  open,
  anchorEl,
  mode,
  initial,
  workspaceId,
  readOnly,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [value, setValue] = useState<ReminderFormValue>(initial)

  useEffect(() => {
    setValue(initial)
  }, [initial])

  const members = trpc.workspace.listMembers.useQuery(
    { workspaceId },
    { enabled: open && value.audience === 'LIST' },
  )

  const dueAtDate = value.dueAt ? new Date(value.dueAt) : null
  const submitDisabled = useMemo(() => {
    if (readOnly) return true
    if (!value.dueAt) return true
    if (new Date(value.dueAt).getTime() <= Date.now()) return true
    if (value.audience === 'LIST' && value.recipients.length === 0) return true
    return false
  }, [value, readOnly])

  const toggleOffset = (n: number) => {
    setValue((v) => ({
      ...v,
      offsets: v.offsets.includes(n) ? v.offsets.filter((x) => x !== n) : [...v.offsets, n],
    }))
  }

  const handleSubmit = () => {
    onSave(value)
    onClose()
  }

  const postpone = (deltaDays: number) => {
    if (!value.dueAt) return
    const d = new Date(value.dueAt)
    d.setDate(d.getDate() + deltaDays)
    onSave({ ...value, dueAt: d.toISOString() })
    onClose()
  }

  const postponeMonth = () => {
    if (!value.dueAt) return
    const d = new Date(value.dueAt)
    d.setMonth(d.getMonth() + 1)
    onSave({ ...value, dueAt: d.toISOString() })
    onClose()
  }

  const toggleRecipient = (userId: string) => {
    setValue((v) => ({
      ...v,
      recipients: v.recipients.includes(userId)
        ? v.recipients.filter((x) => x !== userId)
        : [...v.recipients, userId],
    }))
  }

  const toggleDone = () => {
    const next = value.doneAt ? null : new Date().toISOString()
    onSave({ ...value, doneAt: next })
    onClose()
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
    >
      <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
        <Box sx={{ p: 2, width: 360 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="subtitle1">Напоминание</Typography>
            <IconButton size="small" onClick={onClose} aria-label="Закрыть">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Stack spacing={2}>
            <TextField
              label="Лейбл"
              size="small"
              value={value.label ?? ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setValue({ ...value, label: e.target.value || null })
              }
              disabled={readOnly}
              inputProps={{ maxLength: 200 }}
              fullWidth
            />

            <DateTimePicker
              label="Дедлайн"
              value={dueAtDate}
              onChange={(d: Date | null) => setValue({ ...value, dueAt: d ? d.toISOString() : null })}
              disablePast
              disabled={readOnly}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />

            <FormControl disabled={readOnly}>
              <FormLabel>Напомнить заранее</FormLabel>
              <Stack>
                {OFFSET_PRESETS.map((o) => (
                  <FormControlLabel
                    key={o.value}
                    control={
                      <Checkbox
                        size="small"
                        checked={value.offsets.includes(o.value)}
                        onChange={() => toggleOffset(o.value)}
                      />
                    }
                    label={o.label}
                  />
                ))}
              </Stack>
            </FormControl>

            <FormControl disabled={readOnly}>
              <FormLabel>Для кого</FormLabel>
              <RadioGroup
                value={value.audience}
                onChange={(_: React.ChangeEvent<HTMLInputElement>, v: string) =>
                  setValue({
                    ...value,
                    audience: v as Audience,
                    recipients: v === 'LIST' ? value.recipients : [],
                  })
                }
              >
                <FormControlLabel
                  value="ME"
                  control={<Radio size="small" />}
                  label="Только я"
                />
                <FormControlLabel
                  value="WORKSPACE"
                  control={<Radio size="small" />}
                  label="Весь workspace"
                />
                <FormControlLabel
                  value="LIST"
                  control={<Radio size="small" />}
                  label="Выбрать участников"
                />
              </RadioGroup>
              {value.audience === 'LIST' && (
                <Stack sx={{ pl: 3, maxHeight: 180, overflow: 'auto' }}>
                  {(members.data ?? []).map((m) => (
                    <FormControlLabel
                      key={m.user.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={value.recipients.includes(m.user.id)}
                          onChange={() => toggleRecipient(m.user.id)}
                        />
                      }
                      label={
                        `${m.user.firstName ?? ''} ${m.user.lastName ?? ''}`.trim() ||
                        m.user.email
                      }
                    />
                  ))}
                </Stack>
              )}
            </FormControl>

            {mode === 'edit' && !readOnly && (
              <>
                <Divider />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="caption">Перенести:</Typography>
                  <Button size="small" onClick={() => postpone(1)}>
                    +1 день
                  </Button>
                  <Button size="small" onClick={() => postpone(7)}>
                    +1 неделя
                  </Button>
                  <Button size="small" onClick={postponeMonth}>
                    +1 месяц
                  </Button>
                </Stack>

                <FormControlLabel
                  control={
                    <Checkbox size="small" checked={!!value.doneAt} onChange={toggleDone} />
                  }
                  label="Выполнено"
                />
              </>
            )}

            <Divider />
            <Stack direction="row" justifyContent="space-between">
              {mode === 'edit' && !readOnly ? (
                <Button
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => {
                    onDelete?.()
                    onClose()
                  }}
                >
                  Удалить
                </Button>
              ) : (
                <span />
              )}
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={onClose}>
                  Отмена
                </Button>
                {!readOnly && (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={submitDisabled}
                    onClick={handleSubmit}
                  >
                    {mode === 'create' ? 'Создать' : 'Сохранить'}
                  </Button>
                )}
              </Stack>
            </Stack>
          </Stack>
        </Box>
      </LocalizationProvider>
    </Popover>
  )
}
