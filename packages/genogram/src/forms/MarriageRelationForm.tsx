import { useState } from 'react'
import { Button, Checkbox, FormControlLabel, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { UnionDraft } from '../yjs/actions'
import type { PartialDate, UnionKind } from '../types/domain'
import { PartialDateInput } from './primitives/PartialDateInput'
import { RU } from '../i18n/ru'

interface Props {
  initial: Partial<UnionDraft>
  onSubmit: (draft: UnionDraft) => void
  onCancel: () => void
  submitLabel?: string
  embedded?: boolean
}

export function MarriageRelationForm({ initial, onSubmit, onCancel, submitLabel = RU.drawer.save, embedded = false }: Props) {
  const [kind, setKind] = useState<UnionKind>(initial.kind ?? 'marriage')
  const [startDate, setStartDate] = useState<PartialDate | undefined>(initial.startDate)
  const [endDate, setEndDate] = useState<PartialDate | undefined>(initial.endDate)
  const [divorced, setDivorced] = useState<boolean>(!!initial.divorce)
  const [divorceDate, setDivorceDate] = useState<PartialDate | undefined>(initial.divorce?.date)
  const [ended, setEnded] = useState<boolean>(!!initial.endDate && initial.kind === 'cohabitation')

  const submit = () => {
    if (kind === 'marriage') {
      onSubmit({
        kind: 'marriage',
        startDate,
        divorce: divorced ? { date: divorceDate, markPosition: initial.divorce?.markPosition } : undefined,
      })
    } else {
      onSubmit({
        kind: 'cohabitation',
        startDate,
        endDate: ended ? endDate : undefined,
      })
    }
  }

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        value={kind}
        onChange={(_e, next: UnionKind | null) => { if (next) setKind(next) }}
      >
        <ToggleButton value="marriage">{RU.fields.marriage}</ToggleButton>
        <ToggleButton value="cohabitation">{RU.fields.cohabitation}</ToggleButton>
      </ToggleButtonGroup>

      {kind === 'marriage' ? (
        <>
          <PartialDateInput label={RU.fields.weddingDate} value={startDate ?? {}} onChange={(v) => setStartDate(Object.keys(v).length ? v : undefined)} />
          <FormControlLabel
            control={<Checkbox checked={divorced} onChange={(e) => setDivorced(e.target.checked)} />}
            label={RU.fields.divorced}
          />
          {divorced && (
            <PartialDateInput label={RU.fields.divorceDate} value={divorceDate ?? {}} onChange={(v) => setDivorceDate(Object.keys(v).length ? v : undefined)} />
          )}
        </>
      ) : (
        <>
          <PartialDateInput label={RU.fields.relationStartDate} value={startDate ?? {}} onChange={(v) => setStartDate(Object.keys(v).length ? v : undefined)} />
          <FormControlLabel
            control={<Checkbox checked={ended} onChange={(e) => setEnded(e.target.checked)} />}
            label={RU.fields.relationEnded}
          />
          {ended && (
            <PartialDateInput label={RU.fields.relationEndDate} value={endDate ?? {}} onChange={(v) => setEndDate(Object.keys(v).length ? v : undefined)} />
          )}
        </>
      )}

      {!embedded && (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
          <Button variant="contained" onClick={submit}>{submitLabel}</Button>
        </Stack>
      )}
    </Stack>
  )
}
