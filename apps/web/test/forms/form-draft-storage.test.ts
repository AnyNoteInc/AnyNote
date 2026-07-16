import { describe, expect, it } from 'vitest'

import type { PublicFormVersion } from '@repo/domain/database/forms'

import {
  clearFormDraft,
  formDraftStorageKey,
  getBrowserFormDraftStorage,
  loadFormDraft,
  remapDraft,
  restoreFormDraft,
  saveFormDraft,
} from '@/lib/form-draft-storage'

const DAY = 24 * 60 * 60 * 1_000
const SAVED_AT = new Date('2026-07-16T12:00:00.000Z')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function version(
  questions: PublicFormVersion['questions'],
  fingerprintTitle = 'Анкета',
): PublicFormVersion {
  return {
    schemaVersion: 1,
    firstSectionId: 'section-1',
    presentation: {
      title: fingerprintTitle,
      submitButtonText: 'Отправить',
      hideAnyNoteBranding: false,
    },
    sections: [{ id: 'section-1', title: 'Данные', questionIds: questions.map(({ id }) => id) }],
    questions,
    transitions: [
      {
        id: 'transition-1',
        fromSectionId: 'section-1',
        priority: 0,
        when: null,
        target: { kind: 'ENDING', endingId: 'ending-1' },
      },
    ],
    endings: [{ id: 'ending-1', title: 'Готово' }],
  }
}

const textQuestion = (id: string): PublicFormVersion['questions'][number] => ({
  id,
  sectionId: 'section-1',
  valueType: 'TEXT',
  label: id,
  required: false,
  syncWithPropertyName: false,
  input: { kind: 'TEXT', multiline: false, maxLength: 200 },
})

describe('form draft storage', () => {
  it('keys a draft by locator and version fingerprint', () => {
    expect(formDraftStorageKey('anf_route', 'sha256-value')).toBe(
      'anynote:form:anf_route:sha256-value',
    )
  })

  it('round-trips answers for seven days and expires them afterwards', () => {
    const storage = memoryStorage()
    const key = formDraftStorageKey('anf_route', 'v1')
    saveFormDraft(storage, key, { 'q-email': 'a@b.test' }, SAVED_AT)

    expect(loadFormDraft(storage, key, new Date(SAVED_AT.getTime() + 7 * DAY))).toMatchObject({
      answers: { 'q-email': 'a@b.test' },
      savedAt: SAVED_AT.toISOString(),
    })
    expect(loadFormDraft(storage, key, new Date(SAVED_AT.getTime() + 7 * DAY + 1))).toBeNull()
    expect(storage.getItem(key)).toBeNull()
  })

  it('removes malformed or structurally invalid JSON', () => {
    const storage = memoryStorage()
    storage.setItem('broken', '{')
    expect(loadFormDraft(storage, 'broken', SAVED_AT)).toBeNull()
    expect(storage.getItem('broken')).toBeNull()

    storage.setItem('wrong', JSON.stringify({ savedAt: SAVED_AT.toISOString(), answers: [] }))
    expect(loadFormDraft(storage, 'wrong', SAVED_AT)).toBeNull()
    expect(storage.getItem('wrong')).toBeNull()
  })

  it('clears a draft after success or an explicit reset', () => {
    const storage = memoryStorage()
    saveFormDraft(storage, 'draft', { q: 'answer' }, SAVED_AT)
    clearFormDraft(storage, 'draft')
    expect(storage.getItem('draft')).toBeNull()
  })

  it('remaps compatible values by stable question id and retains incompatible values separately', () => {
    const oldVersion = version([textQuestion('q-email'), textQuestion('q-removed')])
    const newVersion = version([
      textQuestion('q-email'),
      {
        ...textQuestion('q-removed'),
        valueType: 'NUMBER',
        input: { kind: 'NUMBER', min: 0 },
      },
    ])

    expect(
      remapDraft(oldVersion, newVersion, {
        'q-email': 'a@b.test',
        'q-removed': 'not a number',
        'q-no-longer-present': 'keep until confirmed',
      }),
    ).toEqual({
      compatible: { 'q-email': 'a@b.test' },
      incompatible: {
        'q-removed': 'not a number',
        'q-no-longer-present': 'keep until confirmed',
      },
    })
  })

  it('does not touch browser storage during SSR', () => {
    expect(getBrowserFormDraftStorage()).toBeNull()
  })

  it('restores the newest compatible prior-version draft without deleting incompatible values', () => {
    const storage = memoryStorage()
    const oldVersion = version([textQuestion('q-email'), textQuestion('q-removed')])
    const nextVersion = version([
      textQuestion('q-email'),
      {
        ...textQuestion('q-removed'),
        valueType: 'NUMBER',
        input: { kind: 'NUMBER' },
      },
    ])
    const oldKey = formDraftStorageKey('anf_route', 'old-fingerprint')
    saveFormDraft(
      storage,
      oldKey,
      { 'q-email': 'a@b.test', 'q-removed': 'local-only' },
      SAVED_AT,
      oldVersion,
    )

    expect(
      restoreFormDraft(storage, 'anf_route', 'new-fingerprint', nextVersion, SAVED_AT),
    ).toEqual({
      answers: { 'q-email': 'a@b.test' },
      incompatible: { 'q-removed': 'local-only' },
      sourceKey: oldKey,
    })
    expect(storage.getItem(oldKey)).not.toBeNull()
  })

  it('does not skip a valid prior draft after removing a malformed candidate', () => {
    const storage = memoryStorage()
    const nextVersion = version([textQuestion('q-email')])
    const malformedKey = formDraftStorageKey('anf_route', 'a-malformed')
    const validKey = formDraftStorageKey('anf_route', 'b-valid')
    storage.setItem(malformedKey, '{')
    saveFormDraft(
      storage,
      validKey,
      { 'q-email': 'a@b.test' },
      SAVED_AT,
      version([textQuestion('q-email')]),
    )

    expect(
      restoreFormDraft(storage, 'anf_route', 'new-fingerprint', nextVersion, SAVED_AT),
    ).toMatchObject({ answers: { 'q-email': 'a@b.test' }, sourceKey: validKey })
    expect(storage.getItem(malformedKey)).toBeNull()
  })

  it('treats storage enumeration failures as an empty draft store', () => {
    const throwingLength = {
      ...memoryStorage(),
      get length(): number {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    expect(
      restoreFormDraft(
        throwingLength,
        'anf_route',
        'new-fingerprint',
        version([textQuestion('q-email')]),
        SAVED_AT,
      ),
    ).toBeNull()

    const throwingKey = memoryStorage()
    throwingKey.setItem('unrelated', 'value')
    throwingKey.key = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    expect(
      restoreFormDraft(
        throwingKey,
        'anf_route',
        'new-fingerprint',
        version([textQuestion('q-email')]),
        SAVED_AT,
      ),
    ).toBeNull()
  })
})
