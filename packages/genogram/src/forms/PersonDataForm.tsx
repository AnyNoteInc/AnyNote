import { useCallback, useState } from 'react'
import { Button, Checkbox, FormControlLabel, Stack, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { PersonDataDraft } from '../yjs/actions'
import type { ApproximateAge, BirthMode, LifeStatus, PartialDate } from '../types/domain'
import { SexToggle } from './primitives/SexToggle'
import { LifeStatusToggle } from './primitives/LifeStatusToggle'
import { PartialDateInput } from './primitives/PartialDateInput'
import { ApproximateAgeInput } from './primitives/ApproximateAgeInput'
import { RU } from '../i18n/ru'

type FormContext =
  | {
      kind: 'edit-data'
      isPartnerOfMultiBase?: boolean
      totalPartnersOfBase?: number
      isChild?: boolean
      childOrder?: number
      siblingsCount?: number
    }
  | { kind: 'add-partner'; existingPartnersOfBase: number }
  | { kind: 'add-child' }

const DEFAULT_CONTEXT: FormContext = { kind: 'edit-data' }

interface Props {
  initial: Partial<PersonDataDraft & { partnerOrder?: number; childOrder?: number }>
  context?: FormContext
  onSubmit: (draft: PersonDataDraft & { partnerOrder?: number; childOrder?: number; partnerCount?: number }) => void
  onChange?: (draft: PersonDataDraft & { partnerOrder?: number; childOrder?: number; partnerCount?: number }) => void
  onCancel: () => void
  submitLabel?: string
  embedded?: boolean
}

export function PersonDataForm({
  initial,
  context = DEFAULT_CONTEXT,
  onSubmit,
  onChange,
  onCancel,
  submitLabel = RU.drawer.save,
  embedded = false,
}: Props) {
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

  const [partnerCount, setPartnerCount] = useState<number | undefined>(
    context.kind === 'add-partner' ? context.existingPartnersOfBase + 1 : undefined,
  )

  const [partnerOrder, setPartnerOrder] = useState<number | undefined>(initial.partnerOrder)

  const [childOrder, setChildOrder] = useState<number | undefined>(
    context.kind === 'edit-data' ? context.childOrder : undefined,
  )

  const buildPayload = useCallback(
    (
      d: PersonDataDraft,
      pc: number | undefined,
      po: number | undefined,
      co: number | undefined,
    ): PersonDataDraft & { partnerOrder?: number; childOrder?: number; partnerCount?: number } => {
      const payload: PersonDataDraft & { partnerOrder?: number; childOrder?: number; partnerCount?: number } = { ...d }
      if (context.kind === 'add-partner') {
        payload.partnerCount = pc
      }
      if (context.kind === 'edit-data' && context.isPartnerOfMultiBase) {
        payload.partnerOrder = po
      }
      if (context.kind === 'edit-data' && context.isChild) {
        payload.childOrder = co
      }
      return payload
    },
    // context fields are stable for the lifetime of a form instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [context.kind],
  )

  // Call onChange synchronously so parent components (AddPartnerForm, AddChildrenForm)
  // always have the latest value when their Save button is clicked, even under
  // Playwright's rapid fill → click timing.
  const update = <K extends keyof PersonDataDraft>(k: K, v: PersonDataDraft[K]) => {
    const next = { ...draft, [k]: v }
    setDraft(next)
    onChange?.(buildPayload(next, partnerCount, partnerOrder, childOrder))
  }

  const handlePartnerCount = (v: number) => {
    setPartnerCount(v)
    onChange?.(buildPayload(draft, v, partnerOrder, childOrder))
  }

  const handlePartnerOrder = (v: number) => {
    setPartnerOrder(v)
    onChange?.(buildPayload(draft, partnerCount, v, childOrder))
  }

  const handleChildOrder = (v: number) => {
    setChildOrder(v)
    onChange?.(buildPayload(draft, partnerCount, partnerOrder, v))
  }

  const handleSubmit = () => {
    onSubmit(buildPayload(draft, partnerCount, partnerOrder, childOrder))
  }

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

      {context.kind === 'add-partner' && (
        <TextField
          label="Укажите количество партнёров"
          type="number"
          value={partnerCount ?? ''}
          onChange={(e) => handlePartnerCount(Number(e.target.value))}
          inputProps={{ min: context.existingPartnersOfBase + 1 }}
        />
      )}

      {context.kind === 'edit-data' && context.isPartnerOfMultiBase && (
        <TextField
          label="Порядковый номер партнёра"
          type="number"
          value={partnerOrder ?? ''}
          onChange={(e) => handlePartnerOrder(Number(e.target.value))}
          inputProps={{ min: 1, max: context.totalPartnersOfBase }}
        />
      )}

      {context.kind === 'edit-data' && context.isChild && (
        <TextField
          label="Порядковый номер ребёнка"
          type="number"
          value={childOrder ?? ''}
          onChange={(e) => handleChildOrder(Number(e.target.value))}
          inputProps={{ min: 1, max: context.siblingsCount }}
        />
      )}

      {!embedded && (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
          <Button variant="contained" onClick={handleSubmit}>{submitLabel}</Button>
        </Stack>
      )}
    </Stack>
  )
}
