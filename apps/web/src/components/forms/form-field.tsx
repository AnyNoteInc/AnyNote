'use client'

import { Controller, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import {
  Box,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import type { PublicFormQuestion } from '@repo/domain/database/forms'

export type FormAnswerValues = { answers: Record<string, unknown> }

interface FormFieldProps {
  readonly question: PublicFormQuestion
  readonly fieldKey: string
  readonly control: Control<FormAnswerValues>
  readonly register: UseFormRegister<FormAnswerValues>
  readonly errors: FieldErrors<FormAnswerValues>
  readonly disabled?: boolean
}

function errorFor(errors: FieldErrors<FormAnswerValues>, fieldKey: string): string | undefined {
  const issue = errors.answers?.[fieldKey]
  return typeof issue?.message === 'string' ? issue.message : undefined
}

export function FormField({
  question,
  fieldKey,
  control,
  register,
  errors,
  disabled,
}: FormFieldProps) {
  const input = question.input
  const name = `answers.${fieldKey}` as const
  const error = errorFor(errors, fieldKey)
  const label = `${question.label}${question.required ? ' *' : ''}`
  const helper = error ?? question.description

  if (input.kind === 'CHECKBOX') {
    return (
      <FormControl error={Boolean(error)} disabled={disabled} sx={{ width: '100%' }}>
        <Controller
          name={name}
          control={control}
          defaultValue={false}
          render={({ field }) => (
            <FormControlLabel
              control={
                <Checkbox
                  checked={field.value === true}
                  onChange={(_, checked) => field.onChange(checked)}
                />
              }
              label={label}
            />
          )}
        />
        {helper ? <FormHelperText>{helper}</FormHelperText> : null}
      </FormControl>
    )
  }

  if (input.kind === 'SINGLE_CHOICE') {
    return (
      <FormControl error={Boolean(error)} disabled={disabled} fullWidth>
        <FormLabel sx={{ mb: 0.75 }}>{label}</FormLabel>
        <Controller
          name={name}
          control={control}
          defaultValue=""
          render={({ field }) => (
            <Select
              {...field}
              value={typeof field.value === 'string' ? field.value : ''}
              size="small"
            >
              {input.options.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          )}
        />
        {helper ? <FormHelperText>{helper}</FormHelperText> : null}
      </FormControl>
    )
  }

  if (input.kind === 'MULTI_CHOICE') {
    const options = input.options
    return (
      <FormControl error={Boolean(error)} disabled={disabled} fullWidth>
        <FormLabel>{label}</FormLabel>
        <Controller
          name={name}
          control={control}
          defaultValue={[]}
          render={({ field }) => {
            const selected = Array.isArray(field.value) ? field.value : []
            return (
              <Stack sx={{ mt: 0.5 }}>
                {options.map((option) => (
                  <FormControlLabel
                    key={option.id}
                    control={
                      <Checkbox
                        checked={selected.includes(option.id)}
                        onChange={(_, checked) =>
                          field.onChange(
                            checked
                              ? [...selected, option.id]
                              : selected.filter((id) => id !== option.id),
                          )
                        }
                      />
                    }
                    label={option.label}
                  />
                ))}
              </Stack>
            )
          }}
        />
        {helper ? <FormHelperText>{helper}</FormHelperText> : null}
      </FormControl>
    )
  }

  if (
    input.kind === 'FILE' ||
    input.kind === 'PERSON' ||
    input.kind === 'RELATION' ||
    input.kind === 'PAGE_LINK'
  ) {
    return (
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {label}
        </Typography>
        <Box
          sx={{
            mt: 0.75,
            minHeight: 44,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1.5,
            px: 1.5,
            display: 'flex',
            alignItems: 'center',
            color: 'text.secondary',
            bgcolor: 'action.hover',
          }}
        >
          {input.kind === 'FILE'
            ? 'Загрузка файла будет доступна по ссылке'
            : 'Выбор значения будет доступен по ссылке'}
        </Box>
        {helper ? <FormHelperText error={Boolean(error)}>{helper}</FormHelperText> : null}
      </Box>
    )
  }

  const isNumber = input.kind === 'NUMBER'
  const isDate = input.kind === 'DATE'
  const type = isNumber
    ? 'number'
    : isDate
      ? input.includeTime
        ? 'datetime-local'
        : 'date'
      : input.kind === 'EMAIL'
        ? 'email'
        : input.kind === 'PHONE'
          ? 'tel'
          : input.kind === 'URL'
            ? 'url'
            : 'text'

  return (
    <TextField
      {...register(name, {
        setValueAs: (value: unknown) => {
          if (value === '') return undefined
          if (input.kind === 'NUMBER') return Number(value)
          if (input.kind === 'DATE' && input.includeTime && typeof value === 'string') {
            return new Date(value).toISOString()
          }
          return value
        },
      })}
      label={label}
      type={type}
      disabled={disabled}
      multiline={input.kind === 'TEXT' && input.multiline}
      minRows={input.kind === 'TEXT' && input.multiline ? 3 : undefined}
      error={Boolean(error)}
      helperText={helper}
      fullWidth
      size="small"
      slotProps={
        input.kind === 'TEXT'
          ? { htmlInput: { maxLength: input.maxLength } }
          : input.kind === 'NUMBER'
            ? { htmlInput: { min: input.min, max: input.max, step: input.step } }
            : undefined
      }
    />
  )
}
