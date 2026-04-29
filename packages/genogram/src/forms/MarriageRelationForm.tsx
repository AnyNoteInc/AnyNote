import { useState } from 'react'
import { Button, Checkbox, FormControlLabel, Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { UnionDraft } from '../yjs/actions'
import type { PartialDate, UnionKind } from '../types/domain'
import { PartialDateInput } from './primitives/PartialDateInput'
import { RU } from '../i18n/ru'

interface Props {
  initial: Partial<UnionDraft>
  onSubmit: (draft: UnionDraft) => void
  onChange?: (draft: UnionDraft) => void
  onCancel: () => void
  submitLabel?: string
  embedded?: boolean
}

export function MarriageRelationForm({ initial, onSubmit, onChange, onCancel, submitLabel = RU.drawer.save, embedded = false }: Props) {
  const [kind, setKind] = useState<UnionKind>(initial.kind ?? 'marriage')
  const [startDate, setStartDate] = useState<PartialDate | undefined>(initial.startDate)
  const [endDate, setEndDate] = useState<PartialDate | undefined>(initial.endDate)
  const [divorced, setDivorced] = useState<boolean>(!!initial.divorce)
  const [divorceDate, setDivorceDate] = useState<PartialDate | undefined>(initial.divorce?.date)
  const [ended, setEnded] = useState<boolean>(!!initial.endDate && initial.kind === 'cohabitation')

  const buildDraft = (
    k: UnionKind,
    sd: PartialDate | undefined,
    ed: PartialDate | undefined,
    div: boolean,
    dd: PartialDate | undefined,
    end: boolean,
  ): UnionDraft => {
    if (k === 'marriage') {
      return {
        kind: 'marriage',
        startDate: sd,
        divorce: div ? { date: dd, markPosition: initial.divorce?.markPosition } : undefined,
      }
    }
    return {
      kind: 'cohabitation',
      startDate: sd,
      // Use an empty PartialDate as a sentinel when the user checks "ended"
      // without entering a date — keeps the checkbox state persisted and
      // signals the slash decoration to render on the bracket.
      endDate: end ? (ed ?? {}) : undefined,
    }
  }

  // Call onChange synchronously so parent components receive the latest draft
  // before their Save button click handler runs (avoids useEffect timing issues).
  const updateKind = (v: UnionKind) => { setKind(v); onChange?.(buildDraft(v, startDate, endDate, divorced, divorceDate, ended)) }
  const updateStartDate = (v: PartialDate | undefined) => { setStartDate(v); onChange?.(buildDraft(kind, v, endDate, divorced, divorceDate, ended)) }
  const updateEndDate = (v: PartialDate | undefined) => { setEndDate(v); onChange?.(buildDraft(kind, startDate, v, divorced, divorceDate, ended)) }
  const updateDivorced = (v: boolean) => { setDivorced(v); onChange?.(buildDraft(kind, startDate, endDate, v, divorceDate, ended)) }
  const updateDivorceDate = (v: PartialDate | undefined) => { setDivorceDate(v); onChange?.(buildDraft(kind, startDate, endDate, divorced, v, ended)) }
  const updateEnded = (v: boolean) => { setEnded(v); onChange?.(buildDraft(kind, startDate, endDate, divorced, divorceDate, v)) }

  const submit = () => {
    onSubmit(buildDraft(kind, startDate, endDate, divorced, divorceDate, ended))
  }

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        value={kind}
        onChange={(_e, next: UnionKind | null) => { if (next) updateKind(next) }}
      >
        <ToggleButton value="marriage">{RU.fields.marriage}</ToggleButton>
        <ToggleButton value="cohabitation">{RU.fields.cohabitation}</ToggleButton>
      </ToggleButtonGroup>

      {kind === 'marriage' ? (
        <>
          <PartialDateInput label={RU.fields.weddingDate} value={startDate ?? {}} onChange={(v) => updateStartDate(Object.keys(v).length ? v : undefined)} />
          <FormControlLabel
            control={<Checkbox checked={divorced} onChange={(e) => updateDivorced(e.target.checked)} />}
            label={RU.fields.divorced}
          />
          {divorced && (
            <PartialDateInput label={RU.fields.divorceDate} value={divorceDate ?? {}} onChange={(v) => updateDivorceDate(Object.keys(v).length ? v : undefined)} />
          )}
        </>
      ) : (
        <>
          <PartialDateInput label={RU.fields.relationStartDate} value={startDate ?? {}} onChange={(v) => updateStartDate(Object.keys(v).length ? v : undefined)} />
          <FormControlLabel
            control={<Checkbox checked={ended} onChange={(e) => updateEnded(e.target.checked)} />}
            label={RU.fields.relationEnded}
          />
          {ended && (
            <PartialDateInput label={RU.fields.relationEndDate} value={endDate ?? {}} onChange={(v) => updateEndDate(Object.keys(v).length ? v : undefined)} />
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
