import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'
import type { OwnerDataDraft } from '../yjs/actions'
import type { PartialDate } from '../types/domain'
import { SexToggle } from './primitives/SexToggle'
import { PartialDateInput } from './primitives/PartialDateInput'
import { RU } from '../i18n/ru'

interface Props {
  mode: 'create' | 'edit'
  initial: Partial<OwnerDataDraft>
  onSubmit: (draft: OwnerDataDraft) => void
  onCancel: () => void
}

export function OwnerDataForm({ mode, initial, onSubmit, onCancel }: Props) {
  const [draft, setDraft] = useState<OwnerDataDraft>({
    sex: initial.sex ?? 'male',
    firstName: initial.firstName,
    lastName: initial.lastName,
    middleName: initial.middleName,
    birthDate: initial.birthDate,
  })

  const update = <K extends keyof OwnerDataDraft>(k: K, v: OwnerDataDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  return (
    <Stack spacing={2}>
      <TextField
        label={RU.fields.lastName}
        value={draft.lastName ?? ''}
        onChange={(e) => update('lastName', e.target.value)}
      />
      <TextField
        label={RU.fields.firstName}
        value={draft.firstName ?? ''}
        onChange={(e) => update('firstName', e.target.value)}
      />
      <TextField
        label={RU.fields.middleName}
        value={draft.middleName ?? ''}
        onChange={(e) => update('middleName', e.target.value)}
      />
      <SexToggle value={draft.sex} onChange={(v) => update('sex', v)} />
      <PartialDateInput
        label={RU.fields.birthDate}
        value={draft.birthDate ?? {}}
        onChange={(v: PartialDate) => update('birthDate', Object.keys(v).length ? v : undefined)}
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button variant="contained" onClick={() => onSubmit(draft)}>
          {mode === 'create' ? RU.drawer.create : RU.drawer.save}
        </Button>
      </Stack>
    </Stack>
  )
}
