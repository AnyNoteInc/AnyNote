'use client'

import { useMemo, useState } from 'react'
import { Controller, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form'
import {
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  AdapterDateFns,
  DatePicker,
  DateTimePicker,
  LocalizationProvider,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
  dateFnsRu,
} from '@repo/ui/components'
import type { PublicFormQuestion } from '@repo/domain/database/forms'

import {
  FormInternalPicker,
  type FormPickerLoader,
  type FormPickerOption,
} from './form-internal-picker'
import { FormUploadField, type FormUploadHandler } from './form-upload-field'

export type FormAnswerValues = { answers: Record<string, unknown> }

const PUBLIC_VALIDATION_MESSAGES: Readonly<Record<string, string>> = {
  REQUIRED_ANSWER: 'Заполните обязательное поле',
  INVALID_TEXT: 'Введите текстовое значение',
  TEXT_TOO_SHORT: 'Ответ слишком короткий',
  TEXT_TOO_LONG: 'Ответ слишком длинный',
  INVALID_NUMBER: 'Введите корректное число',
  NUMBER_TOO_SMALL: 'Число меньше допустимого значения',
  NUMBER_TOO_LARGE: 'Число больше допустимого значения',
  NUMBER_STEP_MISMATCH: 'Число не соответствует допустимому шагу',
  INVALID_OPTION_ID: 'Выберите доступный вариант',
  INVALID_OPTION_IDS: 'Выберите доступные варианты',
  DUPLICATE_OPTION_ANSWER: 'Один вариант выбран несколько раз',
  TOO_FEW_SELECTIONS: 'Выберите больше вариантов',
  TOO_MANY_SELECTIONS: 'Выбрано слишком много вариантов',
  INVALID_CHECKBOX: 'Укажите значение флажка',
  CONSENT_REQUIRED: 'Подтвердите согласие',
  INVALID_DATE: 'Введите корректную дату',
  INVALID_URL: 'Введите корректную ссылку',
  INVALID_EMAIL: 'Введите корректный email',
  INVALID_PHONE: 'Введите корректный номер телефона',
  INVALID_FILE_TOKENS: 'Загрузите файлы ещё раз',
  INVALID_TARGET_IDS: 'Выберите доступные значения',
  INVALID_TARGET_ID: 'Выберите доступное значение',
  UNREACHABLE_ANSWER: 'Обновите ответы и попробуйте снова',
  QUESTION_INPUT_TYPE_MISMATCH: 'Это поле временно недоступно',
  FORM_TARGET_INACCESSIBLE: 'Выбранное значение недоступно. Выберите другое.',
}

export function publicFormValidationMessage(code: string): string {
  return PUBLIC_VALIDATION_MESSAGES[code] ?? 'Проверьте значение поля'
}

const padDatePart = (value: number): string => value.toString().padStart(2, '0')

function parseDateInput(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const [, year, month, day] = match
  const next = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isFinite(next.getTime()) ? next : null
}

function parseDateTimeInput(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})/.exec(value)
  if (match === null) return null
  const [, year, month, day, hour, minute] = match
  const next = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  )
  return Number.isFinite(next.getTime()) ? next : null
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const normalized = Math.abs(offsetMinutes)
  const hours = String(Math.floor(normalized / 60)).padStart(2, '0')
  const minutes = String(normalized % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

function dateInputToIso(value: Date | null): string | undefined {
  if (value === null || !Number.isFinite(value.getTime())) return undefined
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}`
}

function dateTimeInputToIso(value: Date | null): string | undefined {
  if (value === null || !Number.isFinite(value.getTime())) return undefined
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(
    value.getDate(),
  )}T${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}:00${formatOffset(
    -value.getTimezoneOffset(),
  )}`
}

type ChoiceOption = { id: string; label: string }

function visibleChoiceOptions(
  options: readonly ChoiceOption[],
  query: string,
  selectedIds: readonly string[],
): ChoiceOption[] {
  const normalized = query.trim().toLocaleLowerCase()
  const selected = new Set(selectedIds)
  const pinned = options.filter((option) => selected.has(option.id))
  const matches = options
    .filter(
      (option) =>
        !selected.has(option.id) &&
        (!normalized || option.label.toLocaleLowerCase().includes(normalized)),
    )
    .slice(0, 100)
  return [...pinned, ...matches]
}

function SingleChoiceList({
  label,
  required,
  options,
  value,
  error,
  description,
  disabled,
  onChange,
  onBlur,
  inputRef,
  fieldKey,
}: {
  label: string
  required: boolean
  options: readonly ChoiceOption[]
  value: string
  error?: string
  description?: string
  disabled?: boolean
  onChange: (value: string) => void
  onBlur: () => void
  inputRef: (instance: HTMLInputElement | null) => void
  fieldKey: string
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(
    () => visibleChoiceOptions(options, query, value ? [value] : []),
    [options, query, value],
  )
  const helper = error ?? description
  const helperId = `form-field-${fieldKey}-helper`
  const listboxId = `form-field-${fieldKey}-listbox`
  return (
    <FormControl component="fieldset" error={Boolean(error)} disabled={disabled} fullWidth>
      <FormLabel component="legend">{`${label}${required ? ' *' : ''}`}</FormLabel>
      <TextField
        label={`Поиск: ${label}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={onBlur}
        size="small"
        sx={{ mt: 1 }}
        slotProps={{
          htmlInput: {
            ref: inputRef,
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-controls': listboxId,
            'aria-expanded': true,
            'aria-describedby': helper ? helperId : undefined,
            'data-form-picker-search': 'true',
          },
        }}
      />
      <Stack id={listboxId} role="listbox" aria-label={label} sx={{ mt: 0.75, gap: 0.5 }}>
        {visible.map((option) => (
          <Button
            key={option.id}
            type="button"
            role="option"
            aria-selected={value === option.id}
            variant={value === option.id ? 'contained' : 'outlined'}
            onBlur={onBlur}
            onClick={() => onChange(value === option.id ? '' : option.id)}
            sx={{ justifyContent: 'flex-start', textTransform: 'none' }}
          >
            {option.label}
          </Button>
        ))}
      </Stack>
      {options.length > visible.length ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
          Уточните поиск, чтобы увидеть остальные варианты
        </Typography>
      ) : null}
      {helper ? <FormHelperText id={helperId}>{helper}</FormHelperText> : null}
    </FormControl>
  )
}

function MultiChoicePicker({
  label,
  required,
  options,
  selected,
  maxSelections,
  error,
  description,
  disabled,
  onChange,
  onBlur,
  inputRef,
  fieldKey,
}: {
  label: string
  required: boolean
  options: readonly ChoiceOption[]
  selected: readonly string[]
  maxSelections: number
  error?: string
  description?: string
  disabled?: boolean
  onChange: (value: string[]) => void
  onBlur: () => void
  inputRef: (instance: HTMLInputElement | null) => void
  fieldKey: string
}) {
  const [query, setQuery] = useState('')
  const visible = useMemo(
    () => visibleChoiceOptions(options, query, selected),
    [options, query, selected],
  )
  const helper = error ?? description
  const helperId = `form-field-${fieldKey}-helper`
  const listboxId = `form-field-${fieldKey}-listbox`
  return (
    <FormControl component="fieldset" error={Boolean(error)} disabled={disabled} fullWidth>
      <FormLabel component="legend">{`${label}${required ? ' *' : ''}`}</FormLabel>
      <TextField
        label={`Поиск: ${label}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={onBlur}
        size="small"
        sx={{ mt: 1 }}
        slotProps={{
          htmlInput: {
            ref: inputRef,
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-controls': listboxId,
            'aria-expanded': true,
            'aria-describedby': helper ? helperId : undefined,
            'data-form-picker-search': 'true',
          },
        }}
      />
      <Stack
        id={listboxId}
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        sx={{ mt: 0.75, maxHeight: 280, overflowY: 'auto' }}
      >
        {visible.map((option) => {
          const checked = selected.includes(option.id)
          return (
            <FormControlLabel
              key={option.id}
              role="option"
              aria-selected={checked}
              control={
                <Checkbox
                  checked={checked}
                  disabled={disabled || (!checked && selected.length >= maxSelections)}
                  onBlur={onBlur}
                  onChange={(_, nextChecked) =>
                    onChange(
                      nextChecked
                        ? [...selected, option.id]
                        : selected.filter((id) => id !== option.id),
                    )
                  }
                />
              }
              label={option.label}
            />
          )
        })}
      </Stack>
      {options.length > visible.length ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
          Уточните поиск, чтобы увидеть остальные варианты
        </Typography>
      ) : null}
      {helper ? <FormHelperText id={helperId}>{helper}</FormHelperText> : null}
    </FormControl>
  )
}

interface FormFieldProps {
  readonly question: PublicFormQuestion
  readonly fieldKey: string
  readonly control: Control<FormAnswerValues>
  readonly register: UseFormRegister<FormAnswerValues>
  readonly errors: FieldErrors<FormAnswerValues>
  readonly disabled?: boolean
  readonly onUpload?: FormUploadHandler
  readonly onUploadPendingChange?: (pending: boolean) => void
  readonly onLoadPickerOptions?: FormPickerLoader
  readonly initialFileNames?: Readonly<Record<string, string>>
  readonly initialPickerOptions?: Readonly<Record<string, readonly FormPickerOption[]>>
}

export function formFieldError(
  errors: FieldErrors<FormAnswerValues>,
  fieldKey: string,
): string | undefined {
  const issue = errors.answers?.[fieldKey]
  return typeof issue?.message === 'string' ? publicFormValidationMessage(issue.message) : undefined
}

export function FormField({
  question,
  fieldKey,
  control,
  register,
  errors,
  disabled,
  onUpload,
  onUploadPendingChange,
  onLoadPickerOptions,
  initialFileNames,
  initialPickerOptions,
}: FormFieldProps) {
  const input = question.input
  const name = `answers.${fieldKey}` as const
  const error = formFieldError(errors, fieldKey)
  const label = `${question.icon ? `${question.icon} ` : ''}${question.label}${
    question.required ? ' *' : ''
  }`
  const helper = error ?? question.description
  const helperId = helper ? `form-field-${fieldKey}-helper` : undefined

  if (input.kind === 'CHECKBOX') {
    return (
      <FormControl error={Boolean(error)} disabled={disabled} sx={{ width: '100%' }}>
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={
                <Checkbox
                  checked={field.value === true}
                  onBlur={field.onBlur}
                  onChange={(_, checked) => field.onChange(checked)}
                  aria-describedby={helperId}
                  slotProps={{ input: { ref: field.ref } }}
                />
              }
              label={label}
            />
          )}
        />
        {helper ? <FormHelperText id={helperId}>{helper}</FormHelperText> : null}
      </FormControl>
    )
  }

  if (input.kind === 'SINGLE_CHOICE') {
    if (input.appearance === 'LIST') {
      return (
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <SingleChoiceList
              label={question.label}
              required={question.required}
              options={input.options}
              value={typeof field.value === 'string' ? field.value : ''}
              error={error}
              description={question.description}
              disabled={disabled}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              fieldKey={fieldKey}
            />
          )}
        />
      )
    }

    if (input.appearance === 'RADIO') {
      return (
        <FormControl component="fieldset" error={Boolean(error)} disabled={disabled} fullWidth>
          <FormLabel component="legend">{label}</FormLabel>
          <Controller
            name={name}
            control={control}
            render={({ field: { ref, ...field } }) => (
              <RadioGroup
                {...field}
                value={typeof field.value === 'string' ? field.value : ''}
                aria-label={question.label}
                aria-describedby={helperId}
              >
                {input.options.map((option, index) => (
                  <FormControlLabel
                    key={option.id}
                    value={option.id}
                    control={
                      <Radio slotProps={{ input: { ref: index === 0 ? ref : undefined } }} />
                    }
                    label={option.label}
                  />
                ))}
              </RadioGroup>
            )}
          />
          {helper ? <FormHelperText id={helperId}>{helper}</FormHelperText> : null}
        </FormControl>
      )
    }

    const labelId = `form-field-${fieldKey}-label`
    return (
      <FormControl error={Boolean(error)} disabled={disabled} fullWidth size="small">
        <InputLabel id={labelId}>{label}</InputLabel>
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <Select
              {...field}
              inputRef={field.ref}
              labelId={labelId}
              label={label}
              value={typeof field.value === 'string' ? field.value : ''}
              aria-describedby={helperId}
            >
              {input.options.map((option) => (
                <MenuItem key={option.id} value={option.id}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          )}
        />
        {helper ? <FormHelperText id={helperId}>{helper}</FormHelperText> : null}
      </FormControl>
    )
  }

  if (input.kind === 'MULTI_CHOICE') {
    if (input.appearance === 'MULTI_PICKER') {
      return (
        <Controller
          name={name}
          control={control}
          render={({ field }) => (
            <MultiChoicePicker
              label={question.label}
              required={question.required}
              options={input.options}
              selected={Array.isArray(field.value) ? field.value : []}
              maxSelections={input.maxSelections}
              error={error}
              description={question.description}
              disabled={disabled}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              fieldKey={fieldKey}
            />
          )}
        />
      )
    }

    return (
      <FormControl component="fieldset" error={Boolean(error)} disabled={disabled} fullWidth>
        <FormLabel component="legend">{label}</FormLabel>
        <Controller
          name={name}
          control={control}
          render={({ field }) => {
            const selected = Array.isArray(field.value) ? field.value : []
            return (
              <Stack sx={{ mt: 0.5 }} aria-describedby={helperId}>
                {input.options.map((option, index) => (
                  <FormControlLabel
                    key={option.id}
                    control={
                      <Checkbox
                        checked={selected.includes(option.id)}
                        disabled={
                          disabled ||
                          (!selected.includes(option.id) && selected.length >= input.maxSelections)
                        }
                        onBlur={field.onBlur}
                        onChange={(_, checked) =>
                          field.onChange(
                            checked
                              ? [...selected, option.id]
                              : selected.filter((id) => id !== option.id),
                          )
                        }
                        slotProps={{
                          input: { ref: index === 0 ? field.ref : undefined },
                        }}
                      />
                    }
                    label={option.label}
                  />
                ))}
              </Stack>
            )
          }}
        />
        {helper ? <FormHelperText id={helperId}>{helper}</FormHelperText> : null}
      </FormControl>
    )
  }

  if (input.kind === 'FILE') {
    return (
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <FormUploadField
            ref={field.ref}
            questionId={question.id}
            label={question.label}
            description={question.description}
            required={question.required}
            allowedMimeTypes={input.allowedMimeTypes}
            maxBytesPerFile={input.maxBytesPerFile}
            maxFiles={input.maxFiles}
            value={Array.isArray(field.value) ? field.value : []}
            error={error}
            disabled={disabled}
            onChange={field.onChange}
            onUpload={onUpload}
            onPendingChange={onUploadPendingChange}
            initialNames={initialFileNames}
          />
        )}
      />
    )
  }

  if (input.kind === 'PERSON' || input.kind === 'RELATION' || input.kind === 'PAGE_LINK') {
    const multiple = input.kind !== 'PAGE_LINK'
    return (
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <FormInternalPicker
            ref={field.ref}
            questionId={question.id}
            label={question.label}
            description={question.description}
            required={question.required}
            multiple={multiple}
            maxSelections={multiple ? input.maxSelections : 1}
            value={
              multiple
                ? Array.isArray(field.value)
                  ? field.value
                  : []
                : typeof field.value === 'string'
                  ? field.value
                  : ''
            }
            error={error}
            disabled={disabled}
            onChange={field.onChange}
            onLoadOptions={onLoadPickerOptions}
            initialOptions={initialPickerOptions?.[question.id]}
          />
        )}
      />
    )
  }

  if (input.kind === 'DATE' && input.includeTime) {
    return (
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          return (
            <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
              <DateTimePicker
                value={parseDateTimeInput(field.value)}
                onChange={(value) => field.onChange(dateTimeInputToIso(value ?? null))}
                label={label}
                disabled={disabled}
                slotProps={{
                  textField: {
                    name: field.name,
                    error: Boolean(error),
                    helperText: helper,
                    fullWidth: true,
                    size: 'small',
                    onBlur: field.onBlur,
                    slotProps: {
                      input: { ref: field.ref, 'aria-describedby': helper ? helperId : undefined },
                    },
                  },
                  actionBar: { actions: ['clear', 'cancel', 'accept'] },
                }}
                localeText={{
                  cancelButtonLabel: 'Отмена',
                  okButtonLabel: 'Выбрать',
                  clearButtonLabel: 'Очистить',
                }}
              />
            </LocalizationProvider>
          )
        }}
      />
    )
  }

  if (input.kind === 'DATE') {
    return (
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          return (
            <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={dateFnsRu}>
              <DatePicker
                value={parseDateInput(field.value)}
                onChange={(value) => field.onChange(dateInputToIso(value ?? null))}
                label={label}
                disabled={disabled}
                slotProps={{
                  textField: {
                    name: field.name,
                    error: Boolean(error),
                    helperText: helper,
                    fullWidth: true,
                    size: 'small',
                    onBlur: field.onBlur,
                    slotProps: {
                      input: { ref: field.ref, 'aria-describedby': helper ? helperId : undefined },
                    },
                  },
                  actionBar: { actions: ['clear', 'cancel', 'accept'] },
                }}
                localeText={{
                  cancelButtonLabel: 'Отмена',
                  okButtonLabel: 'Выбрать',
                  clearButtonLabel: 'Очистить',
                }}
              />
            </LocalizationProvider>
          )
        }}
      />
    )
  }

  const isNumber = input.kind === 'NUMBER'
  const type = isNumber
    ? 'number'
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
          if (value === '') return input.kind === 'NUMBER' ? null : value
          if (input.kind === 'NUMBER') return Number(value)
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
      slotProps={{
        htmlInput:
          input.kind === 'TEXT'
            ? { maxLength: input.maxLength }
            : input.kind === 'NUMBER'
              ? { min: input.min, max: input.max, step: input.step }
              : undefined,
      }}
    />
  )
}
