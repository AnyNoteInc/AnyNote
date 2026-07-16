import {
  buildQuestionValueSchema,
  publicFormVersionSchema,
  type PublicFormQuestion,
  type PublicFormVersion,
} from '@repo/domain/database/forms'

const FORM_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1_000

type FormDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type EnumerableFormDraftStorage = FormDraftStorage & Pick<Storage, 'length' | 'key'>

export type FormDraft = {
  savedAt: string
  answers: Record<string, unknown>
  version?: PublicFormVersion
}

export type RemappedFormDraft = {
  compatible: Record<string, unknown>
  incompatible: Record<string, unknown>
}

export type RestoredFormDraft = {
  answers: Record<string, unknown>
  incompatible: Record<string, unknown>
  sourceKey: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const assignOwn = (record: Record<string, unknown>, key: string, value: unknown): void => {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

export function formDraftStorageKey(locator: string, versionFingerprint: string): string {
  return `anynote:form:${locator}:${versionFingerprint}`
}

export function getBrowserFormDraftStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function saveFormDraft(
  storage: FormDraftStorage | null | undefined,
  key: string,
  answers: Record<string, unknown>,
  now = new Date(),
  version?: PublicFormVersion,
): boolean {
  if (storage === null || storage === undefined) return false
  try {
    storage.setItem(
      key,
      JSON.stringify({
        savedAt: now.toISOString(),
        answers,
        ...(version === undefined ? {} : { version }),
      }),
    )
    return true
  } catch {
    return false
  }
}

function removeUnreadableDraft(storage: FormDraftStorage, key: string): null {
  try {
    storage.removeItem(key)
  } catch {
    // Storage can become unavailable between getItem and removeItem.
  }
  return null
}

export function loadFormDraft(
  storage: FormDraftStorage | null | undefined,
  key: string,
  now = new Date(),
): FormDraft | null {
  if (storage === null || storage === undefined) return null

  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      typeof parsed['savedAt'] !== 'string' ||
      !isRecord(parsed['answers'])
    ) {
      return removeUnreadableDraft(storage, key)
    }
    const savedAt = Date.parse(parsed['savedAt'])
    if (!Number.isFinite(savedAt) || now.getTime() - savedAt > FORM_DRAFT_TTL_MS) {
      return removeUnreadableDraft(storage, key)
    }
    const version = publicFormVersionSchema.safeParse(parsed['version'])
    return {
      savedAt: parsed['savedAt'],
      answers: parsed['answers'],
      ...(version.success ? { version: version.data } : {}),
    }
  } catch {
    return removeUnreadableDraft(storage, key)
  }
}

export function clearFormDraft(storage: FormDraftStorage | null | undefined, key: string): void {
  if (storage === null || storage === undefined) return
  try {
    storage.removeItem(key)
  } catch {
    // An unavailable storage backend already behaves as an empty draft store.
  }
}

function questionContractMatches(previous: PublicFormQuestion, next: PublicFormQuestion): boolean {
  return (
    previous.valueType === next.valueType &&
    previous.input.kind === next.input.kind &&
    next.input.kind !== 'FILE'
  )
}

export function remapDraft(
  previousVersion: PublicFormVersion,
  nextVersion: PublicFormVersion,
  answers: Record<string, unknown>,
): RemappedFormDraft {
  const previousQuestions = new Map(
    previousVersion.questions.map((question) => [question.id, question]),
  )
  const nextQuestions = new Map(nextVersion.questions.map((question) => [question.id, question]))
  const compatible: Record<string, unknown> = {}
  const incompatible: Record<string, unknown> = {}

  for (const [questionId, value] of Object.entries(answers)) {
    const previous = previousQuestions.get(questionId)
    const next = nextQuestions.get(questionId)
    const canRestore =
      previous !== undefined &&
      next !== undefined &&
      questionContractMatches(previous, next) &&
      buildQuestionValueSchema(next).safeParse(value).success
    assignOwn(canRestore ? compatible : incompatible, questionId, value)
  }

  return { compatible, incompatible }
}

export function restoreFormDraft(
  storage: EnumerableFormDraftStorage | null | undefined,
  locator: string,
  versionFingerprint: string,
  version: PublicFormVersion,
  now = new Date(),
): RestoredFormDraft | null {
  if (storage === null || storage === undefined) return null
  const currentKey = formDraftStorageKey(locator, versionFingerprint)
  const current = loadFormDraft(storage, currentKey, now)
  if (current !== null) {
    return { answers: current.answers, incompatible: {}, sourceKey: currentKey }
  }

  const prefix = `anynote:form:${locator}:`
  const candidates: Array<{ key: string; draft: FormDraft }> = []
  const keys: string[] = []
  try {
    const length = storage.length
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index)
      if (key !== null && key !== currentKey && key.startsWith(prefix)) keys.push(key)
    }
  } catch {
    return null
  }
  for (const key of keys) {
    const draft = loadFormDraft(storage, key, now)
    if (draft?.version !== undefined) candidates.push({ key, draft })
  }
  candidates.sort((left, right) => Date.parse(right.draft.savedAt) - Date.parse(left.draft.savedAt))
  const previous = candidates[0]
  if (previous === undefined || previous.draft.version === undefined) return null
  const remapped = remapDraft(previous.draft.version, version, previous.draft.answers)
  return {
    answers: remapped.compatible,
    incompatible: remapped.incompatible,
    sourceKey: previous.key,
  }
}
