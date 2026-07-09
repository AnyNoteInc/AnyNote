'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  CheckCircleIcon,
  Collapse,
  ErrorOutlineIcon,
  ExpandMoreIcon,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'

import { trpc } from '@/trpc/client'

interface FormulaEditorProps {
  readonly value: string
  readonly onChange: (next: string) => void
  readonly disabled?: boolean
}

// The function library mirrors `@repo/domain/database/formula/functions.ts`. Kept in
// sync by hand (a static doc list — importing the runtime registry would drag the
// domain/db modules into the client bundle). Grouped for a readable reference.
const FUNCTION_REFERENCE: ReadonlyArray<{
  group: string
  items: ReadonlyArray<{ sig: string; desc: string }>
}> = [
  {
    group: 'Логика',
    items: [
      { sig: 'if(условие, a, b)', desc: 'a если истина, иначе b' },
      { sig: 'empty(x)', desc: 'пусто ли значение' },
      { sig: 'not(x)', desc: 'логическое отрицание' },
      { sig: 'and(...)', desc: 'все аргументы истинны' },
      { sig: 'or(...)', desc: 'хотя бы один истинен' },
    ],
  },
  {
    group: 'Текст',
    items: [
      { sig: 'concat(...)', desc: 'склеить значения в строку' },
      { sig: 'length(s)', desc: 'длина строки' },
      { sig: 'contains(s, sub)', desc: 'содержит ли подстроку' },
    ],
  },
  {
    group: 'Числа',
    items: [
      { sig: 'round(n[, знаков])', desc: 'округление' },
      { sig: 'abs(n)', desc: 'модуль числа' },
      { sig: 'min(...)', desc: 'минимум' },
      { sig: 'max(...)', desc: 'максимум' },
      { sig: 'sum(...)', desc: 'сумма' },
    ],
  },
  {
    group: 'Даты',
    items: [
      { sig: 'now()', desc: 'текущая дата и время' },
      { sig: "dateAdd(d, n, 'days')", desc: 'прибавить (days/weeks/months/years)' },
      { sig: "dateSubtract(d, n, 'days')", desc: 'вычесть интервал' },
      { sig: "dateBetween(a, b, 'days')", desc: 'разница между датами' },
      { sig: "formatDate(d, 'yyyy-MM-dd')", desc: 'форматировать дату' },
      { sig: 'year(d) / month(d) / day(d)', desc: 'части даты' },
    ],
  },
  {
    group: 'Ссылки на свойства',
    items: [{ sig: 'prop("Название")', desc: 'значение другого свойства строки' }],
  },
]

/**
 * FORMULA expression editor. A multiline textarea writes `settings.formula`; a
 * collapsible reference lists the supported functions; live (debounced) syntax
 * validation calls `database.validateFormula` and shows a valid/invalid chip with
 * the parser error. Runtime concerns (unknown prop/function) are NOT syntax errors
 * and validate as OK — they surface as a cell error chip on read.
 */
export function FormulaEditor({ value, onChange, disabled }: FormulaEditorProps) {
  const [refOpen, setRefOpen] = useState(false)
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 350)
    return () => clearTimeout(t)
  }, [value])

  const validation = trpc.database.validateFormula.useQuery(
    { expression: debounced },
    { enabled: debounced.trim().length > 0, retry: false },
  )

  const status = useMemo(() => {
    if (debounced.trim().length === 0) return null
    if (validation.isLoading) return { kind: 'loading' as const }
    const data = validation.data
    if (!data) return null
    return data.valid ? { kind: 'valid' as const } : { kind: 'invalid' as const, error: data.error }
  }, [debounced, validation.isLoading, validation.data])

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Формула
      </Typography>
      <TextField
        multiline
        minRows={3}
        maxRows={8}
        fullWidth
        size="small"
        placeholder={'Напр.: concat(prop("Имя"), " — ", prop("Статус"))'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}

        sx={{ '& textarea': { fontFamily: 'monospace', fontSize: 13 } }}
        slotProps={{ htmlInput: { 'aria-label': 'Выражение формулы', spellCheck: false } }}
      />

      <Box sx={{ minHeight: 24, mt: 0.5 }}>
        {status?.kind === 'valid' ? (
          <Stack direction="row" spacing={0.5} sx={{ color: 'success.main', alignItems: 'center' }}>
            <CheckCircleIcon fontSize="small" />
            <Typography variant="caption">Формула корректна</Typography>
          </Stack>
        ) : null}
        {status?.kind === 'invalid' ? (
          <Stack direction="row" spacing={0.5} sx={{ color: 'error.main', alignItems: 'center' }}>
            <ErrorOutlineIcon fontSize="small" />
            <Typography variant="caption">{status.error}</Typography>
          </Stack>
        ) : null}
        {status?.kind === 'loading' ? (
          <Typography variant="caption" color="text.secondary">
            Проверка…
          </Typography>
        ) : null}
      </Box>

      <Button
        size="small"
        onClick={() => setRefOpen((o) => !o)}
        endIcon={
          <ExpandMoreIcon
            sx={{ transform: refOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
          />
        }
        sx={{ mt: 0.5 }}
      >
        Справочник функций
      </Button>
      <Collapse in={refOpen}>
        <Box
          sx={{
            mt: 1,
            p: 1.5,
            borderRadius: 1,
            bgcolor: 'action.hover',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {FUNCTION_REFERENCE.map((section) => (
            <Box key={section.group} sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {section.group}
              </Typography>
              <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                {section.items.map((fn) => (
                  <Box key={fn.sig}>
                    <Typography
                      component="code"
                      sx={{ fontFamily: 'monospace', fontSize: 12.5, color: 'primary.main' }}
                    >
                      {fn.sig}
                    </Typography>
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' — '}
                      {fn.desc}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}
