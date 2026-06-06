'use client'

import { forwardRef } from 'react'
import { InputAdornment, SearchIcon, TextField } from '@repo/ui/components'

interface Props {
  value: string
  onChange: (value: string) => void
}

/**
 * The search field at the top of the create-page dialog. Forwards its ref so
 * the dialog can focus it on open. Labelled for assistive tech.
 */
export const TemplateSearchInput = forwardRef<HTMLInputElement, Props>(
  function TemplateSearchInput({ value, onChange }, ref) {
    return (
      <TextField
        inputRef={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Поиск шаблонов"
        fullWidth
        size="small"
        autoComplete="off"
        slotProps={{
          htmlInput: { 'aria-label': 'Поиск шаблонов' },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
          },
        }}
      />
    )
  },
)
