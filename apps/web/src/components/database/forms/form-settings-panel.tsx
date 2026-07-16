'use client'

import {
  Alert,
  Box,
  Checkbox,
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
} from '@repo/ui/components'
import type {
  FormGraphError,
  FormTransitionTarget,
  FormVersionDocument,
} from '@repo/domain/database/forms'

import type { FormBuilderAction, FormBuilderState } from './form-builder-state'

interface FormSettingsPanelProps {
  readonly state: FormBuilderState
  readonly errors: readonly FormGraphError[]
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
  errors,
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
        {errors.length > 0 ? (
          <Alert severity="error" variant="outlined">
            <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 700 }}>
              Исправьте маршрут
            </Typography>
            <Stack component="ul" sx={{ m: 0, pl: 2 }}>
              {errors.map((error, index) => (
                <Typography component="li" variant="caption" key={`${error.code}-${index}`}>
                  {error.code}
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
                <FormControl size="small" fullWidth>
                  <InputLabel>Перейти к</InputLabel>
                  <Select
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
              </Stack>
            ))}
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
          </>
        ) : null}
      </Stack>
    </Stack>
  )
}
