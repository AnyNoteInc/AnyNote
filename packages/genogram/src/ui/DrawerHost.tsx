import { useRef, useState } from 'react'
import * as Y from 'yjs'
import { Button, Drawer, Stack, Typography } from '@mui/material'
import type { DrawerState } from './ui-state'
import type { PersonId } from '../types/ids'
import { RU } from '../i18n/ru'
import { OwnerDataForm } from '../forms/OwnerDataForm'
import { PersonDataForm } from '../forms/PersonDataForm'
import { MarriageRelationForm } from '../forms/MarriageRelationForm'
import { AddChildrenForm } from '../forms/AddChildrenForm'
import {
  addChildren,
  addPartner,
  createOwnerWithParents,
  setChildOrder,
  setPartnerOrder,
  setUnionDivorce,
  updatePerson,
  updateUnion,
} from '../yjs/actions'
import type { PersonDataDraft, UnionDraft } from '../yjs/actions'
import { assembleDomain } from '../yjs/assembleDomain'
import type { GenogramPageData } from '../types/page'
import { getBaseOf, countPartnersOf, getChildGroupOf } from '../model/computed'

interface Props {
  doc: Y.Doc
  drawer: DrawerState
  onClose: () => void
}

const DRAWER_WIDTH = 360

const TITLES: Record<DrawerState['mode'], string> = {
  closed: '',
  'create-genogram': RU.drawer.titleCreate,
  'edit-data': RU.drawer.titleEditData,
  'edit-owner-data': RU.drawer.titleEditOwner,
  'add-partner': RU.drawer.titleAddPartner,
  'edit-connection': RU.drawer.titleEditConnection,
  'add-children': RU.drawer.titleAddChildren,
}

export function DrawerHost({ doc, drawer, onClose }: Readonly<Props>) {
  const open = drawer.mode !== 'closed'
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: DRAWER_WIDTH, p: 2 } }}
    >
      <Stack spacing={2}>
        <Typography variant="h6">{TITLES[drawer.mode]}</Typography>
        {renderForm(doc, drawer, onClose)}
      </Stack>
    </Drawer>
  )
}

function renderForm(doc: Y.Doc, drawer: DrawerState, onClose: () => void) {
  if (drawer.mode === 'closed') return null
  const domain = assembleDomain(doc)

  if (drawer.mode === 'create-genogram') {
    return (
      <OwnerDataForm
        mode="create"
        initial={{ sex: 'male' }}
        onCancel={onClose}
        onSubmit={(d) => {
          createOwnerWithParents(doc, d)
          onClose()
        }}
      />
    )
  }

  if (drawer.mode === 'edit-owner-data') {
    const owner = domain.entities.people[drawer.personId]
    if (!owner) return null
    return (
      <OwnerDataForm
        mode="edit"
        initial={{
          sex: owner.sex,
          firstName: owner.identity.firstName,
          lastName: owner.identity.lastName,
          middleName: owner.identity.middleName,
          birthDate: owner.lifeDates.birthDate,
        }}
        onCancel={onClose}
        onSubmit={(d) => {
          updatePerson(doc, drawer.personId, {
            sex: d.sex,
            identity: {
              ...owner.identity,
              firstName: d.firstName,
              lastName: d.lastName,
              middleName: d.middleName,
            },
            lifeDates: { ...owner.lifeDates, birthDate: d.birthDate },
          })
          onClose()
        }}
      />
    )
  }

  if (drawer.mode === 'edit-data') {
    return renderEditDataForm(doc, drawer.personId, domain, onClose)
  }

  if (drawer.mode === 'add-partner') {
    const baseId = drawer.basePersonId
    const existingPartnersOfBase = countPartnersOf(baseId, domain.entities.unions)
    return (
      <AddPartnerForm
        doc={doc}
        basePersonId={baseId}
        existingPartnersOfBase={existingPartnersOfBase}
        onCancel={onClose}
        onSubmit={onClose}
      />
    )
  }

  if (drawer.mode === 'edit-connection') {
    const u = domain.entities.unions[drawer.unionId]
    if (!u) return null
    return (
      <MarriageRelationForm
        initial={{ kind: u.kind, startDate: u.startDate, endDate: u.endDate, divorce: u.divorce }}
        onCancel={onClose}
        onSubmit={(draft) => {
          if (draft.divorce) {
            setUnionDivorce(doc, drawer.unionId, draft.divorce)
          } else {
            setUnionDivorce(doc, drawer.unionId, undefined)
          }
          updateUnion(doc, drawer.unionId, {
            kind: draft.kind,
            startDate: draft.startDate,
            endDate: draft.kind === 'cohabitation' ? draft.endDate : undefined,
          })
          onClose()
        }}
      />
    )
  }

  if (drawer.mode === 'add-children') {
    const cg = Object.values(domain.entities.childGroups).find((c) => c.unionId === drawer.unionId)
    const existing = (cg?.children ?? []).map((entry) => {
      if (entry.kind === 'person') {
        const person = domain.entities.people[entry.personId]
        const label =
          [person?.identity.lastName, person?.identity.firstName, person?.identity.middleName]
            .filter(Boolean)
            .join(' ') || 'Неизвестный'
        return { entry, label }
      }
      return { entry, label: entry.kind === 'loss' ? '(потеря)' : '?' }
    })
    return (
      <AddChildrenForm
        existingChildren={existing}
        onCancel={onClose}
        onSubmit={(newEntries, reorderExisting) => {
          addChildren(doc, drawer.unionId, newEntries, reorderExisting)
          onClose()
        }}
      />
    )
  }

  return null
}

function renderEditDataForm(
  doc: Y.Doc,
  personId: PersonId,
  domain: GenogramPageData,
  onClose: () => void,
) {
  const p = domain.entities.people[personId]
  if (!p) return null
  const baseId = getBaseOf(personId, domain.entities.unions)
  const totalPartnersOfBase = baseId ? countPartnersOf(baseId, domain.entities.unions) : 0
  const isPartnerOfMultiBase = totalPartnersOfBase > 1
  const childGroup = getChildGroupOf(personId, domain.entities.childGroups)
  const isChild = !!childGroup
  const childOrder = childGroup
    ? childGroup.children.findIndex((c) => c.kind === 'person' && c.personId === personId) + 1
    : undefined
  return (
    <PersonDataForm
      initial={{
        sex: p.sex,
        firstName: p.identity.firstName,
        lastName: p.identity.lastName,
        middleName: p.identity.middleName,
        birthMode: p.lifeDates.birthMode,
        lifeStatus: p.lifeDates.lifeStatus,
        birthDate: p.lifeDates.birthDate,
        approximateAge: p.lifeDates.approximateAge,
        deathDate: p.lifeDates.deathDate,
        tragically: p.lifeDates.tragically,
        partnerOrder: p.partnerOrder,
      }}
      context={{
        kind: 'edit-data',
        isPartnerOfMultiBase,
        totalPartnersOfBase: totalPartnersOfBase || undefined,
        isChild,
        childOrder,
        siblingsCount: childGroup?.children.length,
      }}
      onCancel={onClose}
      onSubmit={(d) => {
        updatePerson(doc, personId, {
          sex: d.sex,
          identity: {
            ...p.identity,
            firstName: d.firstName,
            lastName: d.lastName,
            middleName: d.middleName,
          },
          lifeDates: {
            birthMode: d.birthMode,
            lifeStatus: d.lifeStatus,
            birthDate: d.birthDate,
            approximateAge: d.approximateAge,
            deathDate: d.deathDate,
            tragically: d.tragically,
          },
        })
        if (d.partnerOrder !== undefined && d.partnerOrder !== p.partnerOrder) {
          setPartnerOrder(doc, personId, d.partnerOrder)
        }
        if (d.childOrder !== undefined && d.childOrder !== childOrder) {
          setChildOrder(doc, personId, d.childOrder)
        }
        onClose()
      }}
    />
  )
}

// AddPartnerForm composite — combines PersonDataForm + MarriageRelationForm in embedded mode
function AddPartnerForm({
  doc,
  basePersonId,
  existingPartnersOfBase,
  onCancel,
  onSubmit,
}: Readonly<{
  doc: Y.Doc
  basePersonId: PersonId
  existingPartnersOfBase: number
  onCancel: () => void
  onSubmit: () => void
}>) {
  // Use refs so the save-button click closure always reads the latest draft
  // regardless of whether React has re-rendered since the last onChange call.
  const personDraftRef = useRef<PersonDataDraft & { partnerCount?: number }>({
    sex: 'female',
    lifeStatus: 'alive',
    birthMode: 'date',
  })
  const unionDraftRef = useRef<UnionDraft>({ kind: 'marriage' })

  // Keep state in sync so that PersonDataForm / MarriageRelationForm receive
  // up-to-date `initial` values when the embedded forms need to re-render.
  const [personDraft, setPersonDraft] = useState<PersonDataDraft & { partnerCount?: number }>(
    personDraftRef.current,
  )
  const [unionDraft, setUnionDraft] = useState<UnionDraft>(unionDraftRef.current)

  return (
    <Stack spacing={3}>
      <PersonDataForm
        initial={personDraft}
        context={{ kind: 'add-partner', existingPartnersOfBase }}
        onCancel={onCancel}
        onSubmit={() => {}}
        onChange={(d) => {
          personDraftRef.current = d as PersonDataDraft & { partnerCount?: number }
          setPersonDraft(personDraftRef.current)
        }}
        embedded
      />
      <MarriageRelationForm
        initial={unionDraft}
        onCancel={onCancel}
        onSubmit={() => {}}
        onChange={(d) => {
          unionDraftRef.current = d
          setUnionDraft(d)
        }}
        embedded
      />
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button onClick={onCancel}>{RU.drawer.cancel}</Button>
        <Button
          variant="contained"
          onClick={() => {
            // Read from refs to get the latest draft even if React hasn't re-rendered yet
            const latest = personDraftRef.current
            const partnerCount = latest.partnerCount ?? existingPartnersOfBase + 1
            const { partnerCount: _pc, ...rest } = latest
            void _pc
            addPartner(doc, basePersonId, rest, unionDraftRef.current, partnerCount)
            onSubmit()
          }}
        >
          {RU.drawer.save}
        </Button>
      </Stack>
    </Stack>
  )
}
