import { useState } from 'react'
import { Button, Checkbox, FormControlLabel, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { PersonDataDraft } from '../yjs/actions'
import type { ApproximateAge, BirthMode, LifeStatus, PartialDate } from '../types/domain'
import { SexToggle } from './primitives/SexToggle'
import { LifeStatusToggle } from './primitives/LifeStatusToggle'
import { PartialDateInput } from './primitives/PartialDateInput'
import { ApproximateAgeInput } from './primitives/ApproximateAgeInput'
import { RU } from '../i18n/ru'

interface Props {
  initial: Partial<PersonDataDraft>
  onSubmit: (draft: PersonDataDraft) => void
  onCancel: () => void
  submitLabel?: string
  embedded?: boolean
}

export function PersonDataForm({ initial, onSubmit, onCancel, submitLabel = RU.drawer.save, embedded = false }: Props) {
  const [draft, setDraft] = useState<PersonDataDraft>({
    sex: initial.sex ?? 'male',
    birthMode: initial.birthMode ?? 'date',
    lifeStatus: initial.lifeStatus ?? 'unknown',
    firstName: initial.firstName,
    lastName: initial.lastName,
    middleName: initial.middleName,
    birthDate: initial.birthDate,
    approximateAge: initial.approximateAge,
    deathDate: initial.deathDate,
    tragically: initial.tragically,
  })

  const update = <K extends keyof PersonDataDraft>(k: K, v: PersonDataDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  return (
    <Stack spacing={2}>
      <TextField label={RU.fields.lastName} value={draft.lastName ?? ''} onChange={(e) => update('lastName', e.target.value)} />
      <TextField label={RU.fields.firstName} value={draft.firstName ?? ''} onChange={(e) => update('firstName', e.target.value)} />
      <TextField label={RU.fields.middleName} value={draft.middleName ?? ''} onChange={(e) => update('middleName', e.target.value)} />

      <SexToggle value={draft.sex} onChange={(v) => update('sex', v)} />

      <ToggleButtonGroup
        exclusive
        value={draft.birthMode}
        onChange={(_e, next: BirthMode | null) => {
          if (next) update('birthMode', next)
        }}
      >
        <ToggleButton value="date">{RU.fields.birthDate}</ToggleButton>
        <ToggleButton value="approximate">{RU.fields.approximateAge}</ToggleButton>
      </ToggleButtonGroup>

      {draft.birthMode === 'date' ? (
        <PartialDateInput
          value={draft.birthDate ?? {}}
          onChange={(v: PartialDate) => update('birthDate', Object.keys(v).length ? v : undefined)}
        />
      ) : (
        <ApproximateAgeInput
          value={draft.approximateAge}
          onChange={(v: ApproximateAge | undefined) => update('approximateAge', v)}
        />
      )}

      <LifeStatusToggle value={draft.lifeStatus} onChange={(v: LifeStatus) => update('lifeStatus', v)} />

      {draft.lifeStatus === 'deceased' && (
        <>
          <PartialDateInput
            label={RU.fields.deathDate}
            value={draft.deathDate ?? {}}
            onChange={(v: PartialDate) => update('deathDate', Object.keys(v).length ? v : undefined)}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={draft.tragically === true}
                onChange={(e) => update('tragically', e.target.checked)}
              />
            }
            label={RU.fields.tragically}
          />
        </>
      )}

      {!embedded && (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
          <Button variant="contained" onClick={() => onSubmit(draft)}>{submitLabel}</Button>
        </Stack>
      )}
    </Stack>
  )
}
