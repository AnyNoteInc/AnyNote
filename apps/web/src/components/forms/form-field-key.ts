import type {
  FormConditionGroup,
  FormConditionNode,
  PublicFormVersion,
} from '@repo/domain/database/forms'

const FIELD_KEY_PREFIX = 'q_'

export function encodeFormFieldKey(questionId: string): string {
  const bytes = new TextEncoder().encode(questionId)
  return `${FIELD_KEY_PREFIX}${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export function decodeFormFieldKey(fieldKey: string): string {
  const hex = fieldKey.startsWith(FIELD_KEY_PREFIX) ? fieldKey.slice(FIELD_KEY_PREFIX.length) : ''
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/u.test(hex)) {
    throw new Error('INVALID_FORM_FIELD_KEY')
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function encodeConditionQuestionIds(node: FormConditionGroup): FormConditionGroup
function encodeConditionQuestionIds(node: FormConditionNode): FormConditionNode
function encodeConditionQuestionIds(node: FormConditionNode): FormConditionNode {
  return node.kind === 'ALL' || node.kind === 'ANY'
    ? { ...node, members: node.members.map(encodeConditionQuestionIds) }
    : { ...node, questionId: encodeFormFieldKey(node.questionId) }
}

export function encodeFormVersionQuestionIds(version: PublicFormVersion): PublicFormVersion {
  return {
    ...version,
    sections: version.sections.map((section) => ({
      ...section,
      questionIds: section.questionIds.map(encodeFormFieldKey),
    })),
    questions: version.questions.map((question) => ({
      ...question,
      id: encodeFormFieldKey(question.id),
      ...(question.visibleWhen === undefined
        ? {}
        : { visibleWhen: encodeConditionQuestionIds(question.visibleWhen) }),
    })),
    transitions: version.transitions.map((transition) => ({
      ...transition,
      when: transition.when === null ? null : encodeConditionQuestionIds(transition.when),
    })),
  }
}
