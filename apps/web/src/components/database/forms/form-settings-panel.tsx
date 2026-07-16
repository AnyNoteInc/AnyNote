'use client'

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
import type { FormTransitionTarget, FormVersionDocument } from '@repo/domain/database/forms'

import type { FormBuilderAction, FormBuilderState } from './form-builder-state'
import type { FormPublishReadinessIssue } from './form-builder-validation'
import { FormConditionEditor } from './form-condition-editor'
import { FormInputConfigEditor } from './form-input-config-editor'
import { FormPresentationEditor } from './form-presentation-editor'

interface FormSettingsPanelProps {
  readonly state: FormBuilderState
  readonly issues: readonly FormPublishReadinessIssue[]
  readonly conditionalLogicEnabled: boolean
  readonly dispatch: React.Dispatch<FormBuilderAction>
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

export function FormSettingsPanel({
  state,
  issues,
  conditionalLogicEnabled,
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
          {section ? 'Раздел' : question ? 'Вопрос' : 'Завершение'}
        </Typography>
      </Box>
      <Stack spacing={2} sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
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

        {section ? (
          <>
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
          </>
        ) : null}

        {question ? (
          <>
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
                onChange={(input) =>
                  dispatch({
                    type: 'QUESTION_UPDATED',
                    questionId: question.id,
                    patch: { input },
                  })
                }
              />
            </Box>
          </>
        ) : null}

        {ending ? (
          <>
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
          </>
        ) : null}
        <Box sx={{ pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <FormPresentationEditor
            presentation={state.document.presentation}
            onChange={(presentation) =>
              dispatch({ type: 'PRESENTATION_UPDATED', patch: presentation })
            }
          />
        </Box>
      </Stack>
    </Stack>
  )
}
