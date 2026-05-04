import type { ReactNode } from 'react'
import { Stack, ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { ChildEntryDraft } from '../yjs/actions'
import { PersonDataForm } from './PersonDataForm'
import { PartialDateInput } from './primitives/PartialDateInput'
import { RU } from '../i18n/ru'

interface Props {
  value: ChildEntryDraft
  onChange: (next: ChildEntryDraft) => void
  readOnly?: boolean
}

export function ChildEntryRow({ value, onChange, readOnly }: Readonly<Props>) {
  let body: ReactNode
  if (value.type !== 'person') {
    body = (
      <PartialDateInput
        label={RU.fields.eventDate}
        value={value.date ?? {}}
        onChange={(v) =>
          onChange({ type: value.type, date: Object.keys(v).length ? v : undefined })
        }
      />
    )
  } else if (readOnly) {
    body = (
      <span>
        {[value.data.lastName, value.data.firstName, value.data.middleName]
          .filter(Boolean)
          .join(' ')}
      </span>
    )
  } else {
    body = (
      <PersonDataForm
        initial={value.data}
        context={{ kind: 'add-child' }}
        onSubmit={(d) => onChange({ type: 'person', data: d })}
        onChange={(d) => onChange({ type: 'person', data: d })}
        onCancel={() => {}}
        embedded
      />
    )
  }

  return (
    <Stack spacing={1}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value.type}
        onChange={(_e, next) => {
          if (next === 'person') {
            onChange({
              type: 'person',
              data: { sex: 'male', lifeStatus: 'alive', birthMode: 'date' },
            })
          } else if (next === 'miscarriage' || next === 'abortion') {
            onChange({ type: next })
          }
        }}
      >
        <ToggleButton value="person">{RU.fields.childKindChild}</ToggleButton>
        <ToggleButton value="miscarriage">{RU.fields.childKindMiscarriage}</ToggleButton>
        <ToggleButton value="abortion">{RU.fields.childKindAbortion}</ToggleButton>
      </ToggleButtonGroup>

      {body}
    </Stack>
  )
}
