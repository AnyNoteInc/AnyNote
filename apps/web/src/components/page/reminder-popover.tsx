'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AdapterDateFns,
  Box,
  Button,
  Chip,
  Checkbox,
  CloseIcon,
  DateTimePicker,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  FormLabel,
  IconButton,
  LocalizationProvider,
  MenuItem,
  Popover,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Tab,
  Tabs,
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

type ReminderTab = 'main' | 'advance' | 'audience'

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
}: Props) {
  const [value, setValue] = useState<ReminderFormValue>(initial)
  const [tab, setTab] = useState<ReminderTab>('main')

  useEffect(() => {
    setValue(initial)
    setTab('main')
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

  const membersById = useMemo(
    () => new Map((members.data ?? []).map((member) => [member.user.id, member])),
    [members.data],
  )

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

  const setRecipients = (recipients: string[]) => {
    setValue((v) => ({
      ...v,
      recipients,
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
        <Box sx={{ p: 2, width: 390 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="subtitle1">Напоминание</Typography>
            <IconButton size="small" onClick={onClose} aria-label="Закрыть">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Stack spacing={2}>
            <Tabs
              value={tab}
              onChange={(_, next: ReminderTab) => setTab(next)}
              variant="fullWidth"
              sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}
            >
              <Tab value="main" label="Основное" />
              <Tab value="advance" label="Заранее" />
              <Tab value="audience" label="Для кого" />
            </Tabs>

            {tab === 'main' && (
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
                  onChange={(d: Date | null) =>
                    setValue({ ...value, dueAt: d ? d.toISOString() : null })
                  }
                  disablePast
                  disabled={readOnly}
                  localeText={{
                    cancelButtonLabel: 'Отмена',
                    okButtonLabel: 'Применить',
                  }}
                  slotProps={{
                    textField: { size: 'small', fullWidth: true },
                    actionBar: { actions: ['cancel', 'accept'] },
                  }}
                />

                {mode === 'edit' && !readOnly && (
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
                )}
              </Stack>
            )}

            {tab === 'advance' && (
              <FormControl disabled={readOnly}>
                <FormLabel sx={{ mb: 0.5 }}>Напомнить заранее</FormLabel>
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
            )}

            {tab === 'audience' && (
              <FormControl disabled={readOnly}>
                <FormLabel sx={{ mb: 0.5 }}>Для кого</FormLabel>
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
                  <FormControlLabel value="ME" control={<Radio size="small" />} label="Только я" />
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
                  <FormControl size="small" fullWidth sx={{ mt: 1 }}>
                    <InputLabel id="reminder-recipients-label">Участники</InputLabel>
                    <Select
                      labelId="reminder-recipients-label"
                      multiple
                      label="Участники"
                      value={value.recipients}
                      onChange={(event) => {
                        const selected = event.target.value
                        setRecipients(
                          Array.isArray(selected) ? selected : String(selected).split(','),
                        )
                      }}
                      disabled={readOnly || members.isLoading}
                      renderValue={(selected) => (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                          {(selected as string[]).map((id) => {
                            const member = membersById.get(id)
                            if (!member) return null
                            const fullName =
                              `${member.user.firstName ?? ''} ${member.user.lastName ?? ''}`.trim() ||
                              member.user.email
                            return (
                              <Chip
                                key={id}
                                size="small"
                                label={`${fullName} · ${member.user.email}`}
                                sx={{ maxWidth: '100%' }}
                              />
                            )
                          })}
                        </Box>
                      )}
                    >
                      {(members.data ?? []).map((member) => {
                        const fullName =
                          `${member.user.firstName ?? ''} ${member.user.lastName ?? ''}`.trim() ||
                          member.user.email
                        return (
                          <MenuItem key={member.user.id} value={member.user.id}>
                            <Checkbox
                              size="small"
                              checked={value.recipients.includes(member.user.id)}
                            />
                            <Stack sx={{ minWidth: 0 }}>
                              <Typography variant="body2">{fullName}</Typography>
                              <Typography variant="caption" color="text.secondary">
                                {member.user.email}
                              </Typography>
                            </Stack>
                          </MenuItem>
                        )
                      })}
                    </Select>
                  </FormControl>
                )}
              </FormControl>
            )}

            <Divider />
            <Stack direction="row" justifyContent="space-between">
              {mode === 'edit' && !readOnly ? (
                <Button
                  size="small"
                  color={value.doneAt ? 'warning' : 'primary'}
                  variant={value.doneAt ? 'contained' : 'outlined'}
                  onClick={toggleDone}
                >
                  {value.doneAt ? 'Не выполнено' : 'Выполнено'}
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
