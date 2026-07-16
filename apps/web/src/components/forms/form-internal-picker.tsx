'use client'

import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormHelperText,
  FormLabel,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

export type FormPickerOption = { id: string; label: string }
export type FormPickerPage = {
  items: readonly FormPickerOption[]
  nextCursor: string | null
}
export type FormPickerLoader = (
  questionId: string,
  query: string,
  cursor?: string,
) => Promise<FormPickerPage>

interface FormInternalPickerProps {
  readonly questionId: string
  readonly label: string
  readonly description?: string
  readonly required?: boolean
  readonly multiple: boolean
  readonly maxSelections: number
  readonly value: string | readonly string[] | undefined
  readonly error?: string
  readonly disabled?: boolean
  readonly onChange: (value: string | string[]) => void
  readonly onLoadOptions?: FormPickerLoader
  readonly initialOptions?: readonly FormPickerOption[]
}

export const FormInternalPicker = forwardRef<HTMLInputElement, FormInternalPickerProps>(
  function FormInternalPicker(
    {
      questionId,
      label,
      description,
      required,
      multiple,
      maxSelections,
      value,
      error,
      disabled,
      onChange,
      onLoadOptions,
      initialOptions,
    },
    forwardedRef,
  ) {
    const [query, setQuery] = useState('')
    const [opened, setOpened] = useState(false)
    const [loading, setLoading] = useState(false)
    const [loadError, setLoadError] = useState<string>()
    const [options, setOptions] = useState<FormPickerOption[]>(() => [...(initialOptions ?? [])])
    const [nextCursor, setNextCursor] = useState<string | null>(null)
    const requestId = useRef(0)
    const selectedIds = useMemo(
      () =>
        multiple
          ? Array.isArray(value)
            ? [...value]
            : []
          : typeof value === 'string' && value
            ? [value]
            : [],
      [multiple, value],
    )
    const labels = useMemo(
      () => new Map(options.map((option) => [option.id, option.label])),
      [options],
    )
    const helperId = `form-picker-${questionId}-helper`

    async function load(cursor?: string) {
      if (!onLoadOptions) return
      const currentRequest = ++requestId.current
      setLoading(true)
      setLoadError(undefined)
      try {
        const page = await onLoadOptions(questionId, query, cursor)
        if (currentRequest !== requestId.current) return
        setOptions((current) => {
          const selected = cursor
            ? current
            : current.filter((option) => selectedIds.includes(option.id))
          return [...new Map([...selected, ...page.items].map((item) => [item.id, item])).values()]
        })
        setNextCursor(page.nextCursor)
      } catch {
        if (currentRequest === requestId.current) setLoadError('Не удалось загрузить варианты')
      } finally {
        if (currentRequest === requestId.current) setLoading(false)
      }
    }

    useEffect(() => {
      if (!opened || !onLoadOptions) return
      const timeout = globalThis.setTimeout(() => void load(), query ? 250 : 0)
      return () => globalThis.clearTimeout(timeout)
      // `load` deliberately follows the current search text and callback.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opened, onLoadOptions, query, questionId])

    function select(option: FormPickerOption) {
      if (multiple) {
        if (selectedIds.includes(option.id) || selectedIds.length >= maxSelections) return
        onChange([...selectedIds, option.id])
      } else {
        onChange(option.id)
      }
    }

    function remove(id: string) {
      if (multiple) onChange(selectedIds.filter((selectedId) => selectedId !== id))
      else onChange('')
    }

    return (
      <FormControl error={Boolean(error)} disabled={disabled} fullWidth>
        <FormLabel sx={{ mb: 0.75, fontWeight: 650 }}>
          {label}
          {required ? ' *' : ''}
        </FormLabel>
        {selectedIds.length > 0 ? (
          <Stack direction="row" useFlexGap sx={{ mb: 1, flexWrap: 'wrap', gap: 0.75 }}>
            {selectedIds.map((id) => (
              <Chip
                key={id}
                label={labels.get(id) ?? id}
                onDelete={disabled ? undefined : () => remove(id)}
                size="small"
              />
            ))}
          </Stack>
        ) : null}
        <TextField
          inputRef={forwardedRef}
          label={`Поиск: ${label}`}
          value={query}
          onFocus={() => setOpened(true)}
          onChange={(event) => {
            setOpened(true)
            setQuery(event.target.value)
          }}
          disabled={disabled || !onLoadOptions}
          error={Boolean(error)}
          aria-describedby={description || error || loadError ? helperId : undefined}
          size="small"
          slotProps={{
            input: loading
              ? { endAdornment: <CircularProgress size={18} aria-label="Загрузка вариантов" /> }
              : undefined,
            htmlInput: { 'data-form-picker-search': 'true' },
          }}
        />
        {!onLoadOptions ? (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75 }}>
            Выбор доступен только в опубликованной форме
          </Typography>
        ) : null}
        {opened && options.length > 0 ? (
          <Stack
            role="listbox"
            aria-label={`Варианты: ${label}`}
            sx={{ mt: 0.75, border: 1, borderColor: 'divider', borderRadius: 1.5, p: 0.5 }}
          >
            {options.map((option) => {
              const selected = selectedIds.includes(option.id)
              return (
                <Button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-label={`${selected ? 'Убрать' : 'Выбрать'} ${option.label}`}
                  disabled={!selected && multiple && selectedIds.length >= maxSelections}
                  onClick={() => (selected ? remove(option.id) : select(option))}
                  sx={{ justifyContent: 'flex-start', minHeight: 40, textTransform: 'none' }}
                >
                  {option.label}
                </Button>
              )
            })}
            {nextCursor ? (
              <Button type="button" onClick={() => void load(nextCursor)} disabled={loading}>
                Показать ещё
              </Button>
            ) : null}
          </Stack>
        ) : null}
        {error || loadError || description ? (
          <FormHelperText id={helperId}>{error ?? loadError ?? description}</FormHelperText>
        ) : null}
      </FormControl>
    )
  },
)
