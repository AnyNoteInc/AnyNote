'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  AddIcon,
  Alert,
  ArrowDownwardIcon,
  ArrowUpwardIcon,
  Box,
  Button,
  Checkbox,
  DeleteOutlineIcon,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  IconButton,
} from '@repo/ui/components'
import type {
  FormOptionSnapshot,
  FormTransitionTarget,
  FormVersionDocument,
} from '@repo/domain/database/forms'

import type { FormBuilderAction, FormBuilderState } from './form-builder-state'
import type { FormPublishReadinessIssue } from './form-builder-validation'
import { FormConditionEditor } from './form-condition-editor'
import { FormInputConfigEditor } from './form-input-config-editor'
import { FormPresentationEditor } from './form-presentation-editor'
import { IconPickerPopover } from '../../page/icon-picker-popover'

interface FormSettingsPanelProps {
  readonly state: FormBuilderState
  readonly issues: readonly FormPublishReadinessIssue[]
  readonly properties: ReadonlyArray<{ id: string; settings?: unknown }>
  readonly conditionalLogicEnabled: boolean
  readonly editable: boolean
  readonly dispatch: React.Dispatch<FormBuilderAction>
}

function persistedOptions(settings: unknown): FormOptionSnapshot[] {
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return []
  const options = (settings as { options?: unknown }).options
  if (!Array.isArray(options)) return []
  return options.flatMap((option) => {
    if (option === null || typeof option !== 'object' || Array.isArray(option)) return []
    const { id, label, color } = option as { id?: unknown; label?: unknown; color?: unknown }
    return typeof id === 'string' && typeof label === 'string'
      ? [{ id, label, ...(typeof color === 'string' ? { color } : {}) }]
      : []
  })
}

function transitionTargetValue(
  target: FormTransitionTarget,
  document: FormVersionDocument,
): string {
  if (target.kind === 'SECTION') {
    return document.sections.some(({ id }) => id === target.sectionId)
      ? `section:${target.sectionId}`
      : ''
  }
  return document.endings.some(({ id }) => id === target.endingId)
    ? `ending:${target.endingId}`
    : ''
}

function defaultAnswerText(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

function readDefaultAnswer(raw: string): unknown | undefined {
  const normalized = raw.trim()
  if (normalized === '') return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function FormSettingsPanel({
  state,
  issues,
  properties,
  conditionalLogicEnabled,
  editable,
  dispatch,
}: FormSettingsPanelProps) {
  const selection = state.selection
  const section =
    selection.kind === 'SECTION'
      ? state.document.sections.find(({ id }) => id === selection.id)
      : undefined
  const question =
    selection.kind === 'QUESTION'
      ? state.document.questions.find(({ id }) => id === selection.id)
      : undefined
  const ending =
    selection.kind === 'ENDING'
      ? state.document.endings.find(({ id }) => id === selection.id)
      : undefined
  const transitions = section
    ? state.document.transitions
        .filter(({ fromSectionId }) => fromSectionId === section.id)
        .sort((left, right) => left.priority - right.priority)
    : []
  const sectionIndex = section
    ? state.document.sections.findIndex(({ id }) => id === section.id)
    : -1
  const questionOrder = state.document.sections.flatMap((item) => item.questionIds)
  const questionIndex = question ? questionOrder.indexOf(question.id) : -1
  const availableQuestions = state.document.questions.filter((item) => {
    const itemIndex = questionOrder.indexOf(item.id)
    if (question) return itemIndex >= 0 && itemIndex < questionIndex
    if (section) {
      const itemSectionIndex = state.document.sections.findIndex(({ id }) => id === item.sectionId)
      return itemSectionIndex >= 0 && itemSectionIndex <= sectionIndex
    }
    return false
  })
  const contextualIssues = issues.filter(
    ({ entityId }) => entityId === undefined || entityId === selection.id,
  )
  const conditionalTransitions = transitions.filter(({ when }) => when !== null)
  const propertyId =
    question?.property.kind === 'PROPERTY' ? question.property.propertyId : undefined
  const questionPersistedOptions =
    propertyId !== undefined
      ? persistedOptions(properties.find(({ id }) => id === propertyId)?.settings)
      : []
  const [questionDefaultAnswerText, setQuestionDefaultAnswerText] = useState('')
  const [questionIconAnchor, setQuestionIconAnchor] = useState<HTMLElement | null>(null)
  const contextLabel = useMemo(() => {
    if (selection.kind === 'SECTION') return 'Раздел'
    if (selection.kind === 'QUESTION') return 'Вопрос'
    return 'Завершение'
  }, [selection.kind])

  useEffect(() => {
    if (!question) {
      setQuestionDefaultAnswerText('')
      return
    }
    setQuestionDefaultAnswerText(defaultAnswerText(question.defaultAnswer))
  }, [question])

  return (
    <Stack
      component="aside"
      aria-label="Настройки формы"
      sx={{
        minWidth: 0,
        height: '100%',
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="overline" color="text.secondary">
          Контекст
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {contextLabel}
        </Typography>
      </Box>
      <Stack
        component="fieldset"
        disabled={!editable}
        spacing={2}
        sx={{ flex: 1, overflowY: 'auto', p: 2, m: 0, border: 0, opacity: editable ? 1 : 0.65 }}
      >
        {contextualIssues.length > 0 ? (
          <Alert severity="error" variant="outlined">
            <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
              Перед публикацией
            </Typography>
            <Stack component="ul" sx={{ m: 0, pl: 2 }}>
              {contextualIssues.map((issue, index) => (
                <Typography component="li" variant="caption" key={`${issue.code}-${index}`}>
                  <Box component="span" sx={{ display: 'block', fontWeight: 700 }}>
                    {issue.code}
                  </Box>
                  {issue.message}
                </Typography>
              ))}
            </Stack>
          </Alert>
        ) : null}

        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
            Оформление формы
          </Typography>
          <FormPresentationEditor
            presentation={state.document.presentation}
            onChange={(presentation) =>
              dispatch({ type: 'PRESENTATION_UPDATED', patch: presentation })
            }
          />
        </Box>

        {section ? (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Оформление раздела
            </Typography>
            <TextField
              label="Название раздела"
              size="small"
              value={section.title}
              onChange={(event) =>
                dispatch({
                  type: 'SECTION_UPDATED',
                  sectionId: section.id,
                  patch: { title: event.target.value },
                })
              }
            />
            <TextField
              label="Описание"
              size="small"
              multiline
              minRows={2}
              value={section.description ?? ''}
              onChange={(event) =>
                dispatch({
                  type: 'SECTION_UPDATED',
                  sectionId: section.id,
                  patch: { description: event.target.value || undefined },
                })
              }
            />
            <Box>
              <Typography variant="subtitle2">Переходы по приоритету</Typography>
              <Typography variant="caption" color="text.secondary">
                Первое сработавшее условие определяет следующий шаг.
              </Typography>
            </Box>
            {transitions.map((transition, index) => (
              <Stack
                key={transition.id}
                data-testid={`transition-card-${transition.id}`}
                spacing={1}
                sx={{ p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5 }}
              >
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    #{index + 1}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {transition.when === null ? 'Иначе' : 'По условию'}
                  </Typography>
                </Stack>
                {transition.when !== null ? (
                  <FormConditionEditor
                    value={transition.when}
                    availableQuestions={availableQuestions}
                    disabled={!conditionalLogicEnabled}
                    onChange={(when) => {
                      if (when) {
                        dispatch({
                          type: 'TRANSITION_UPDATED',
                          transitionId: transition.id,
                          patch: { when },
                        })
                      }
                    }}
                  />
                ) : null}
                {issues
                  .filter(({ transitionId }) => transitionId === transition.id)
                  .map((transitionIssue) => (
                    <Alert
                      key={`${transitionIssue.code}-${transitionIssue.path.join('.')}`}
                      severity="error"
                      variant="outlined"
                    >
                      <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>
                        {transitionIssue.code}
                      </Typography>
                      {transitionIssue.message !== transitionIssue.code ? (
                        <Typography variant="caption">{transitionIssue.message}</Typography>
                      ) : null}
                    </Alert>
                  ))}
                <FormControl size="small" fullWidth>
                  <InputLabel id={`transition-target-${transition.id}`}>Перейти к</InputLabel>
                  <Select
                    labelId={`transition-target-${transition.id}`}
                    label="Перейти к"
                    value={transitionTargetValue(transition.target, state.document)}
                    onChange={(event) => {
                      const [kind, id] = event.target.value.split(':')
                      dispatch({
                        type: 'TRANSITION_TARGET_UPDATED',
                        transitionId: transition.id,
                        target:
                          kind === 'section'
                            ? { kind: 'SECTION', sectionId: id! }
                            : { kind: 'ENDING', endingId: id! },
                      })
                    }}
                  >
                    {state.document.sections
                      .filter(({ id }) => id !== section.id)
                      .map((target) => (
                        <MenuItem key={target.id} value={`section:${target.id}`}>
                          Раздел · {target.title}
                        </MenuItem>
                      ))}
                    {state.document.endings.map((target) => (
                      <MenuItem key={target.id} value={`ending:${target.id}`}>
                        Завершение · {target.title}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {transition.when !== null ? (
                  <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                    <IconButton
                      size="small"
                      aria-label="Поднять переход"
                      disabled={index === 0}
                      onClick={() =>
                        dispatch({
                          type: 'TRANSITION_MOVED',
                          transitionId: transition.id,
                          index: Math.max(0, index - 1),
                        })
                      }
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Опустить переход"
                      disabled={index >= conditionalTransitions.length - 1}
                      onClick={() =>
                        dispatch({
                          type: 'TRANSITION_MOVED',
                          transitionId: transition.id,
                          index: Math.min(conditionalTransitions.length - 1, index + 1),
                        })
                      }
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label="Удалить переход"
                      onClick={() =>
                        dispatch({ type: 'TRANSITION_DELETED', transitionId: transition.id })
                      }
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ) : null}
              </Stack>
            ))}
            <Button
              size="small"
              startIcon={<AddIcon />}
              disabled={!conditionalLogicEnabled || availableQuestions.length === 0}
              onClick={() => dispatch({ type: 'TRANSITION_ADDED', sectionId: section.id })}
            >
              Добавить условный переход
            </Button>
            <FormHelperText>
              {conditionalLogicEnabled
                ? 'Условия ветвления доступны для переходов выше fallback.'
                : 'Условные переходы доступны на старшем плане.'}
            </FormHelperText>
          </Box>
        ) : null}

        {question ? (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Оформление поля
            </Typography>
            <TextField
              label="Текст вопроса"
              size="small"
              value={question.label}
              onChange={(event) => {
                dispatch({
                  type: 'QUESTION_UPDATED',
                  questionId: question.id,
                  patch: { label: event.target.value },
                })
                if (question.property.kind === 'PROPERTY' && question.syncWithPropertyName) {
                  dispatch({
                    type: 'QUESTION_PROPERTY_NAME_SYNC_SET',
                    questionId: question.id,
                    enabled: true,
                    propertyNameIntent: event.target.value,
                  })
                }
              }}
            />
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button
                variant="outlined"
                size="small"
                onClick={(event) => setQuestionIconAnchor(event.currentTarget)}
              >
                {question.icon ? `Иконка: ${question.icon}` : 'Добавить иконку'}
              </Button>
              {question.icon ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() =>
                    dispatch({
                      type: 'QUESTION_UPDATED',
                      questionId: question.id,
                      patch: { icon: undefined },
                    })
                  }
                >
                  Удалить иконку
                </Button>
              ) : null}
            </Stack>
            <IconPickerPopover
              anchorEl={questionIconAnchor}
              open={Boolean(questionIconAnchor)}
              onClose={() => setQuestionIconAnchor(null)}
              onSelect={(value) =>
                dispatch({
                  type: 'QUESTION_UPDATED',
                  questionId: question.id,
                  patch: { icon: value },
                })
              }
              onRemove={
                question.icon
                  ? () =>
                      dispatch({
                        type: 'QUESTION_UPDATED',
                        questionId: question.id,
                        patch: { icon: undefined },
                      })
                  : undefined
              }
            />
            <TextField
              label="Подсказка"
              size="small"
              multiline
              minRows={2}
              value={question.description ?? ''}
              onChange={(event) =>
                dispatch({
                  type: 'QUESTION_UPDATED',
                  questionId: question.id,
                  patch: { description: event.target.value || undefined },
                })
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={question.required}
                  onChange={(_, checked) =>
                    dispatch({
                      type: 'QUESTION_UPDATED',
                      questionId: question.id,
                      patch: { required: checked },
                    })
                  }
                />
              }
              label="Обязательный ответ"
            />
            <TextField
              label="Значение по умолчанию"
              size="small"
              multiline
              minRows={3}
              value={questionDefaultAnswerText}
              helperText="Если не заполнено пользователем, это значение будет подставлено автоматически."
              onChange={(event) => setQuestionDefaultAnswerText(event.target.value)}
              onBlur={() => {
                dispatch({
                  type: 'QUESTION_UPDATED',
                  questionId: question.id,
                  patch: { defaultAnswer: readDefaultAnswer(questionDefaultAnswerText) },
                })
              }}
            />
            {question.property.kind === 'PROPERTY' ? (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={question.syncWithPropertyName}
                    onChange={(_, checked) =>
                      dispatch({
                        type: 'QUESTION_PROPERTY_NAME_SYNC_SET',
                        questionId: question.id,
                        enabled: checked,
                        propertyNameIntent: checked ? question.label : undefined,
                      })
                    }
                  />
                }
                label="Синхронизировать с названием свойства"
              />
            ) : null}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Условие показа
              </Typography>
              <FormConditionEditor
                value={question.visibleWhen}
                availableQuestions={availableQuestions}
                disabled={!conditionalLogicEnabled}
                onChange={(visibleWhen) =>
                  dispatch({
                    type: 'QUESTION_UPDATED',
                    questionId: question.id,
                    patch: { visibleWhen },
                  })
                }
              />
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Формат ответа
              </Typography>
              <FormInputConfigEditor
                input={question.input}
                persistedOptions={questionPersistedOptions}
                onChange={(input) =>
                  dispatch({
                    type: 'QUESTION_UPDATED',
                    questionId: question.id,
                    patch: { input },
                  })
                }
              />
            </Box>
          </Box>
        ) : null}

        {ending ? (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
              Оформление завершения
            </Typography>
            <TextField
              label="Заголовок"
              size="small"
              value={ending.title}
              onChange={(event) =>
                dispatch({
                  type: 'ENDING_UPDATED',
                  endingId: ending.id,
                  patch: { title: event.target.value },
                })
              }
            />
            <TextField
              label="Текст"
              size="small"
              multiline
              minRows={4}
              value={ending.body ?? ''}
              onChange={(event) =>
                dispatch({
                  type: 'ENDING_UPDATED',
                  endingId: ending.id,
                  patch: { body: event.target.value || undefined },
                })
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={ending.button !== undefined}
                  onChange={(_, checked) =>
                    dispatch({
                      type: 'ENDING_UPDATED',
                      endingId: ending.id,
                      patch: {
                        button: checked
                          ? { label: 'Продолжить', href: 'https://anynote.ru' }
                          : undefined,
                      },
                    })
                  }
                />
              }
              label="Показать кнопку-ссылку"
            />
            {ending.button ? (
              <Stack direction="row" spacing={1}>
                <TextField
                  fullWidth
                  size="small"
                  label="Текст кнопки"
                  value={ending.button.label}
                  onChange={(event) =>
                    dispatch({
                      type: 'ENDING_UPDATED',
                      endingId: ending.id,
                      patch: { button: { ...ending.button!, label: event.target.value } },
                    })
                  }
                />
                <TextField
                  fullWidth
                  size="small"
                  label="Ссылка"
                  value={ending.button.href}
                  onChange={(event) =>
                    dispatch({
                      type: 'ENDING_UPDATED',
                      endingId: ending.id,
                      patch: { button: { ...ending.button!, href: event.target.value } },
                    })
                  }
                />
              </Stack>
            ) : null}
          </Box>
        ) : null}
      </Stack>
    </Stack>
  )
}
