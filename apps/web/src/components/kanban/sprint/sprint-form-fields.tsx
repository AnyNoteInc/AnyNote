'use client'

import {
  AdapterDateFns,
  Box,
  DatePicker,
  LocalizationProvider,
  Stack,
  TextField,
  Typography,
  dateFnsRu,
} from '@repo/ui/components'

export interface SprintFormValues {
  name: string
  description: string
  startDate: Date | null
  endDate: Date | null
}

interface SprintFormFieldsProps {
  readonly values: SprintFormValues
  readonly onChange: (next: SprintFormValues) => void
  readonly autoFocusName?: boolean
}

export function SprintFormFields({ values, onChange, autoFocusName }: SprintFormFieldsProps) {
  function patch(partial: Partial<SprintFormValues>) {
    onChange({ ...values, ...partial })
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Название"
          value={values.name}
          onChange={(e) => patch({ name: e.target.value })}
          fullWidth
          autoFocus={autoFocusName}
        />
        <TextField
          label="Описание"
          value={values.description}
          onChange={(e) => patch({ description: e.target.value })}
          multiline
          minRows={2}
          fullWidth
        />
        <Box>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mb: 0.5 }}
          >
            Период
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <DatePicker
              label="Старт"
              value={values.startDate}
              onChange={(value) => {
                const next: Partial<SprintFormValues> = { startDate: value }
                if (values.endDate && value && value > values.endDate) next.endDate = null
                patch(next)
              }}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
            <Typography color="text.secondary">—</Typography>
            <DatePicker
              label="Финиш"
              value={values.endDate}
              minDate={values.startDate ?? undefined}
              onChange={(value) => patch({ endDate: value })}
              slotProps={{ textField: { size: 'small', fullWidth: true } }}
            />
          </Stack>
        </Box>
      </Stack>
    </LocalizationProvider>
  )
}
