import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'
import { RU } from '../i18n/ru'

interface Props {
  initialText?: string
  onCancel: () => void
  onSubmit: (text: string) => void
}

/**
 * Text editor for genogram annotations. Used for both creating a new note
 * and editing an existing one — caller controls which by passing
 * initialText. Submit is disabled until the user types something so empty
 * notes can never be saved.
 */
export function NoteForm({ initialText = '', onCancel, onSubmit }: Props) {
  const [text, setText] = useState(initialText)
  const trimmed = text.trim()

  return (
    <Stack spacing={2}>
      <TextField
        autoFocus
        multiline
        minRows={3}
        maxRows={10}
        placeholder={RU.noteForm.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button
          variant="contained"
          disabled={trimmed.length === 0}
          onClick={() => onSubmit(trimmed)}
        >
          {RU.drawer.save}
        </Button>
      </Stack>
    </Stack>
  )
}
