'use client'

import type { ChangeEvent } from 'react'
import {
  AddIcon,
  Box,
  Button,
  DeleteOutlineIcon,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@repo/ui/components'
import type {
  FormCondition,
  FormConditionGroup,
  FormConditionNode,
  FormQuestion,
} from '@repo/domain/database/forms'

interface FormConditionEditorProps {
  readonly value?: FormConditionGroup | null
  readonly availableQuestions: readonly FormQuestion[]
  readonly disabled?: boolean
  readonly onChange: (value: FormConditionGroup | undefined) => void
}

type ConditionKind = FormCondition['kind']
type NumberCondition = Extract<FormCondition, { kind: `NUMBER_${string}` }>
type DateCondition = Extract<FormCondition, { kind: `DATE_${string}` }>
type TextCondition = Extract<FormCondition, { kind: `TEXT_${string}` }>

function isNumberCondition(condition: FormCondition): condition is NumberCondition {
  return condition.kind.startsWith('NUMBER_')
}

function isDateCondition(condition: FormCondition): condition is DateCondition {
  return condition.kind.startsWith('DATE_')
}

function isTextCondition(condition: FormCondition): condition is TextCondition {
  return condition.kind.startsWith('TEXT_')
}

const EMPTY_OPERATORS: readonly { value: ConditionKind; label: string }[] = [
  { value: 'IS_EMPTY', label: 'Не заполнено' },
  { value: 'IS_NOT_EMPTY', label: 'Заполнено' },
]

const OPERATORS: Partial<
  Record<FormQuestion['input']['kind'], readonly { value: ConditionKind; label: string }[]>
> = {
  TEXT: [
    { value: 'TEXT_EQUALS', label: 'Равно тексту' },
    { value: 'TEXT_NOT_EQUALS', label: 'Не равно тексту' },
    { value: 'TEXT_CONTAINS', label: 'Содержит текст' },
    { value: 'TEXT_NOT_CONTAINS', label: 'Не содержит текст' },
  ],
  URL: [
    { value: 'TEXT_EQUALS', label: 'Равно тексту' },
    { value: 'TEXT_CONTAINS', label: 'Содержит текст' },
  ],
  EMAIL: [
    { value: 'TEXT_EQUALS', label: 'Равно тексту' },
    { value: 'TEXT_CONTAINS', label: 'Содержит текст' },
  ],
  PHONE: [
    { value: 'TEXT_EQUALS', label: 'Равно тексту' },
    { value: 'TEXT_CONTAINS', label: 'Содержит текст' },
  ],
  NUMBER: [
    { value: 'NUMBER_EQUALS', label: 'Равно' },
    { value: 'NUMBER_NOT_EQUALS', label: 'Не равно' },
    { value: 'NUMBER_GREATER_THAN', label: 'Больше' },
    { value: 'NUMBER_GREATER_THAN_OR_EQUAL', label: 'Больше или равно' },
    { value: 'NUMBER_LESS_THAN', label: 'Меньше' },
    { value: 'NUMBER_LESS_THAN_OR_EQUAL', label: 'Меньше или равно' },
  ],
  DATE: [
    { value: 'DATE_BEFORE', label: 'До даты' },
    { value: 'DATE_AFTER', label: 'После даты' },
    { value: 'DATE_ON', label: 'В дату' },
  ],
  CHECKBOX: [{ value: 'CHECKBOX_IS', label: 'Имеет значение' }],
  SINGLE_CHOICE: [
    { value: 'OPTION_IS', label: 'Выбран вариант' },
    { value: 'OPTION_IS_NOT', label: 'Не выбран вариант' },
  ],
  MULTI_CHOICE: [
    { value: 'OPTION_CONTAINS', label: 'Содержит вариант' },
    { value: 'OPTION_NOT_CONTAINS', label: 'Не содержит вариант' },
  ],
}

function operatorsFor(question: FormQuestion | undefined) {
  return question
    ? [...EMPTY_OPERATORS, ...(OPERATORS[question.input.kind] ?? [])]
    : EMPTY_OPERATORS
}

function makeCondition(question: FormQuestion): FormCondition {
  const first = operatorsFor(question)[0]?.value ?? 'IS_EMPTY'
  return conditionForKind(first, question)
}

function conditionForKind(kind: ConditionKind, question: FormQuestion): FormCondition {
  const base = { questionId: question.id }
  if (kind === 'IS_EMPTY' || kind === 'IS_NOT_EMPTY') return { ...base, kind }
  if (kind === 'CHECKBOX_IS') return { ...base, kind, value: true }
  if (kind.startsWith('NUMBER_')) return { ...base, kind, value: 0 } as FormCondition
  if (kind.startsWith('DATE_')) {
    return { ...base, kind, value: new Date().toISOString() } as FormCondition
  }
  if (kind.startsWith('OPTION_')) {
    const optionId =
      question.input.kind === 'SINGLE_CHOICE' || question.input.kind === 'MULTI_CHOICE'
        ? (question.input.options[0]?.id ?? '')
        : ''
    return { ...base, kind, optionId } as FormCondition
  }
  return { ...base, kind, value: '' } as FormCondition
}

function isGroup(node: FormConditionNode): node is FormConditionGroup {
  return node.kind === 'ALL' || node.kind === 'ANY'
}

function ConditionLeaf({
  condition,
  questions,
  disabled,
  onChange,
  onRemove,
}: {
  condition: FormCondition
  questions: readonly FormQuestion[]
  disabled: boolean
  onChange: (condition: FormCondition) => void
  onRemove: () => void
}) {
  const question = questions.find(({ id }) => id === condition.questionId) ?? questions[0]
  const operators = operatorsFor(question)

  function changeQuestion(event: ChangeEvent<HTMLInputElement>) {
    const next = questions.find(({ id }) => id === event.target.value)
    if (next) onChange(makeCondition(next))
  }

  function changeOperator(event: ChangeEvent<HTMLInputElement>) {
    if (question) onChange(conditionForKind(event.target.value as ConditionKind, question))
  }

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      sx={{ alignItems: { sm: 'center' } }}
    >
      <TextField
        select
        size="small"
        label="Вопрос условия"
        value={question?.id ?? ''}
        disabled={disabled || questions.length === 0}
        onChange={changeQuestion}
        sx={{ minWidth: 160 }}
      >
        {questions.map((item) => (
          <MenuItem key={item.id} value={item.id}>
            {item.label}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label="Оператор условия"
        value={condition.kind}
        disabled={disabled || !question}
        onChange={changeOperator}
        sx={{ minWidth: 180 }}
      >
        {operators.map((operator) => (
          <MenuItem key={operator.value} value={operator.value}>
            {operator.label}
          </MenuItem>
        ))}
      </TextField>
      <ConditionOperand
        condition={condition}
        question={question}
        disabled={disabled}
        onChange={onChange}
      />
      <IconButton aria-label="Удалить условие" disabled={disabled} onClick={onRemove}>
        <DeleteOutlineIcon />
      </IconButton>
    </Stack>
  )
}

function ConditionOperand({
  condition,
  question,
  disabled,
  onChange,
}: {
  condition: FormCondition
  question: FormQuestion | undefined
  disabled: boolean
  onChange: (condition: FormCondition) => void
}) {
  if (condition.kind === 'IS_EMPTY' || condition.kind === 'IS_NOT_EMPTY') return null
  if (condition.kind === 'CHECKBOX_IS') {
    return (
      <TextField
        select
        size="small"
        label="Значение условия"
        value={condition.value ? 'true' : 'false'}
        disabled={disabled}
        onChange={(event) => onChange({ ...condition, value: event.target.value === 'true' })}
        sx={{ minWidth: 120 }}
      >
        <MenuItem value="true">Да</MenuItem>
        <MenuItem value="false">Нет</MenuItem>
      </TextField>
    )
  }
  if ('optionId' in condition) {
    const options =
      question?.input.kind === 'SINGLE_CHOICE' || question?.input.kind === 'MULTI_CHOICE'
        ? question.input.options
        : []
    return (
      <TextField
        select
        size="small"
        label="Вариант условия"
        value={condition.optionId}
        disabled={disabled || options.length === 0}
        onChange={(event) => onChange({ ...condition, optionId: event.target.value })}
        sx={{ minWidth: 140 }}
      >
        {options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
    )
  }
  if (isNumberCondition(condition)) {
    return (
      <TextField
        size="small"
        type="number"
        label="Значение условия"
        value={condition.value}
        disabled={disabled}
        onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })}
        sx={{ width: 150 }}
      />
    )
  }
  if (isDateCondition(condition)) {
    return (
      <TextField
        size="small"
        type="date"
        label="Значение условия"
        value={condition.value.slice(0, 10)}
        disabled={disabled}
        slotProps={{ inputLabel: { shrink: true } }}
        onChange={(event) =>
          onChange({ ...condition, value: `${event.target.value}T00:00:00.000Z` })
        }
      />
    )
  }
  if (isTextCondition(condition))
    return (
      <TextField
        size="small"
        label="Значение условия"
        value={condition.value}
        disabled={disabled}
        onChange={(event) => onChange({ ...condition, value: event.target.value })}
      />
    )
  return null
}

function ConditionGroupEditor({
  group,
  questions,
  disabled,
  root = false,
  onChange,
  onRemove,
}: {
  group: FormConditionGroup
  questions: readonly FormQuestion[]
  disabled: boolean
  root?: boolean
  onChange: (group: FormConditionGroup) => void
  onRemove?: () => void
}) {
  function updateMember(index: number, member: FormConditionNode) {
    onChange({
      ...group,
      members: group.members.map((item, itemIndex) => (itemIndex === index ? member : item)),
    })
  }

  function removeMember(index: number) {
    const members = group.members.filter((_, itemIndex) => itemIndex !== index)
    if (members.length === 0 && onRemove) onRemove()
    else onChange({ ...group, members })
  }

  return (
    <Stack
      spacing={1.25}
      sx={{ p: root ? 0 : 1.5, border: root ? 0 : 1, borderColor: 'divider', borderRadius: 1.5 }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel id={root ? 'root-condition-kind' : undefined}>Совпадение</InputLabel>
          <Select
            labelId={root ? 'root-condition-kind' : undefined}
            label="Совпадение"
            value={group.kind}
            disabled={disabled}
            onChange={(event) => onChange({ ...group, kind: event.target.value as 'ALL' | 'ANY' })}
          >
            <MenuItem value="ALL">Все условия</MenuItem>
            <MenuItem value="ANY">Любое условие</MenuItem>
          </Select>
        </FormControl>
        {!root && onRemove ? (
          <IconButton aria-label="Удалить группу условий" disabled={disabled} onClick={onRemove}>
            <DeleteOutlineIcon />
          </IconButton>
        ) : null}
      </Stack>
      {group.members.map((member, index) =>
        isGroup(member) ? (
          <ConditionGroupEditor
            key={`group-${index}`}
            group={member}
            questions={questions}
            disabled={disabled}
            onChange={(next) => updateMember(index, next)}
            onRemove={() => removeMember(index)}
          />
        ) : (
          <ConditionLeaf
            key={`condition-${index}`}
            condition={member}
            questions={questions}
            disabled={disabled}
            onChange={(next) => updateMember(index, next)}
            onRemove={() => removeMember(index)}
          />
        ),
      )}
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={disabled || questions.length === 0}
          onClick={() =>
            questions[0] &&
            onChange({ ...group, members: [...group.members, makeCondition(questions[0])] })
          }
        >
          Добавить условие
        </Button>
        <Button
          size="small"
          disabled={disabled || questions.length === 0}
          onClick={() =>
            questions[0] &&
            onChange({
              ...group,
              members: [...group.members, { kind: 'ALL', members: [makeCondition(questions[0])] }],
            })
          }
        >
          Добавить группу
        </Button>
      </Stack>
    </Stack>
  )
}

export function FormConditionEditor({
  value,
  availableQuestions,
  disabled = false,
  onChange,
}: FormConditionEditorProps) {
  if (!value) {
    return (
      <Box>
        <Button
          size="small"
          startIcon={<AddIcon />}
          disabled={disabled || availableQuestions.length === 0}
          onClick={() =>
            availableQuestions[0] &&
            onChange({ kind: 'ALL', members: [makeCondition(availableQuestions[0])] })
          }
        >
          Добавить условие
        </Button>
        {disabled ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Условная логика недоступна на текущем тарифе.
          </Typography>
        ) : null}
      </Box>
    )
  }

  return (
    <ConditionGroupEditor
      root
      group={value}
      questions={availableQuestions}
      disabled={disabled}
      onChange={(next) => (next.members.length === 0 ? onChange(undefined) : onChange(next))}
    />
  )
}
