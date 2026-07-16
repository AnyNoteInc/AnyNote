'use client'

import {
  AddIcon,
  ArrowDownwardIcon,
  ArrowUpwardIcon,
  Box,
  Button,
  DeleteOutlineIcon,
  IconButton,
  Stack,
  Typography,
} from '@repo/ui/components'
import {
  FORM_PROPERTY_TYPES,
  type FormPropertyRef,
  type FormPropertyType,
} from '@repo/domain/database/forms'

import type {
  FormBuilderAction,
  FormBuilderState,
  FormBuilderSelection,
} from './form-builder-state'

interface FormPropertyOption {
  readonly id: string
  readonly name: string
  readonly type: string
}

interface FormOutlinePanelProps {
  readonly state: FormBuilderState
  readonly properties: readonly FormPropertyOption[]
  readonly dispatch: React.Dispatch<FormBuilderAction>
}

function OutlineItem({
  selected,
  label,
  meta,
  onSelect,
  onUp,
  onDown,
  onDelete,
}: {
  selected: boolean
  label: string
  meta?: string
  onSelect: () => void
  onUp?: () => void
  onDown?: () => void
  onDelete?: () => void
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'center',
        minHeight: 44,
        pl: 1.25,
        pr: 0.25,
        borderRadius: 1.5,
        bgcolor: selected ? 'action.selected' : 'transparent',
        borderLeft: 3,
        borderColor: selected ? 'primary.main' : 'transparent',
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={onSelect}
        sx={{
          border: 0,
          bgcolor: 'transparent',
          color: 'inherit',
          textAlign: 'left',
          minWidth: 0,
          py: 0.75,
          cursor: 'pointer',
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 2,
          },
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: selected ? 700 : 500 }} noWrap>
          {label}
        </Typography>
        {meta ? (
          <Typography variant="caption" color="text.secondary">
            {meta}
          </Typography>
        ) : null}
      </Box>
      <Stack direction="row" sx={{ opacity: selected ? 1 : 0.45 }}>
        {onUp ? (
          <IconButton size="small" aria-label={`Переместить «${label}» выше`} onClick={onUp}>
            <ArrowUpwardIcon sx={{ fontSize: 15 }} />
          </IconButton>
        ) : null}
        {onDown ? (
          <IconButton size="small" aria-label={`Переместить «${label}» ниже`} onClick={onDown}>
            <ArrowDownwardIcon sx={{ fontSize: 15 }} />
          </IconButton>
        ) : null}
        {onDelete ? (
          <IconButton size="small" aria-label={`Удалить «${label}»`} onClick={onDelete}>
            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ) : null}
      </Stack>
    </Box>
  )
}

function selected(state: FormBuilderState, selection: FormBuilderSelection): boolean {
  return state.selection.kind === selection.kind && state.selection.id === selection.id
}

export function FormOutlinePanel({ state, properties, dispatch }: FormOutlinePanelProps) {
  const supportedPropertyTypes = new Set<string>(FORM_PROPERTY_TYPES)
  const usedPropertyIds = new Set(
    state.document.questions.flatMap(({ property }) =>
      property.kind === 'PROPERTY' ? [property.propertyId] : [],
    ),
  )
  const hasTitle = state.document.questions.some(({ property }) => property.kind === 'TITLE')
  const availableProperty = properties.find(
    (property) => !usedPropertyIds.has(property.id) && supportedPropertyTypes.has(property.type),
  )

  function addQuestion(sectionId: string) {
    const property: FormPropertyRef | undefined = !hasTitle
      ? { kind: 'TITLE' }
      : availableProperty &&
          [
            'TEXT',
            'NUMBER',
            'STATUS',
            'SELECT',
            'MULTI_SELECT',
            'CHECKBOX',
            'DATE',
            'PERSON',
            'FILE',
            'URL',
            'EMAIL',
            'PHONE',
            'RELATION',
            'PAGE_LINK',
          ].includes(availableProperty.type)
        ? {
            kind: 'PROPERTY',
            propertyId: availableProperty.id,
            propertyType: availableProperty.type as FormPropertyType,
          }
        : undefined
    if (!property) return
    dispatch({
      type: 'QUESTION_ADDED',
      sectionId,
      property,
      label: property.kind === 'TITLE' ? 'Название' : availableProperty!.name,
    })
  }

  return (
    <Stack
      component="aside"
      aria-label="Структура формы"
      sx={{
        minWidth: 0,
        height: '100%',
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="overline" color="text.secondary">
          Структура
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          {state.document.sections.length} раздела · {state.document.questions.length} вопросов
        </Typography>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 1 }}>
        {state.document.sections.map((section, sectionIndex) => (
          <Box key={section.id} sx={{ mb: 1.25 }}>
            <OutlineItem
              selected={selected(state, { kind: 'SECTION', id: section.id })}
              label={section.title}
              meta={`${section.questionIds.length} вопросов`}
              onSelect={() =>
                dispatch({ type: 'ITEM_SELECTED', selection: { kind: 'SECTION', id: section.id } })
              }
              onUp={
                sectionIndex > 0
                  ? () =>
                      dispatch({
                        type: 'SECTION_MOVED',
                        sectionId: section.id,
                        index: sectionIndex - 1,
                      })
                  : undefined
              }
              onDown={
                sectionIndex < state.document.sections.length - 1
                  ? () =>
                      dispatch({
                        type: 'SECTION_MOVED',
                        sectionId: section.id,
                        index: sectionIndex + 1,
                      })
                  : undefined
              }
              onDelete={
                state.document.sections.length > 1
                  ? () => dispatch({ type: 'SECTION_DELETED', sectionId: section.id })
                  : undefined
              }
            />
            <Stack sx={{ ml: 2, mt: 0.25, pl: 1, borderLeft: 1, borderColor: 'divider' }}>
              {section.questionIds.map((questionId, questionIndex) => {
                const question = state.document.questions.find(({ id }) => id === questionId)
                if (!question) return null
                return (
                  <OutlineItem
                    key={question.id}
                    selected={selected(state, { kind: 'QUESTION', id: question.id })}
                    label={question.label}
                    meta={question.required ? 'Обязательный' : 'Необязательный'}
                    onSelect={() =>
                      dispatch({
                        type: 'ITEM_SELECTED',
                        selection: { kind: 'QUESTION', id: question.id },
                      })
                    }
                    onUp={
                      questionIndex > 0
                        ? () =>
                            dispatch({
                              type: 'QUESTION_MOVED',
                              questionId: question.id,
                              sectionId: section.id,
                              index: questionIndex - 1,
                            })
                        : undefined
                    }
                    onDown={
                      questionIndex < section.questionIds.length - 1
                        ? () =>
                            dispatch({
                              type: 'QUESTION_MOVED',
                              questionId: question.id,
                              sectionId: section.id,
                              index: questionIndex + 1,
                            })
                        : undefined
                    }
                    onDelete={
                      state.document.questions.length > 1
                        ? () => dispatch({ type: 'QUESTION_DELETED', questionId: question.id })
                        : undefined
                    }
                  />
                )
              })}
            </Stack>
            <Button
              size="small"
              startIcon={<AddIcon />}
              disabled={hasTitle && !availableProperty}
              onClick={() => addQuestion(section.id)}
              sx={{ ml: 3, mt: 0.5, minHeight: 36, textTransform: 'none' }}
            >
              Вопрос
            </Button>
          </Box>
        ))}
        <Button
          fullWidth
          size="small"
          startIcon={<AddIcon />}
          onClick={() => dispatch({ type: 'SECTION_ADDED' })}
          sx={{ minHeight: 40, textTransform: 'none' }}
        >
          Добавить раздел
        </Button>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: 'block', mt: 2, px: 1 }}
        >
          Завершения
        </Typography>
        {state.document.endings.map((ending, index) => (
          <OutlineItem
            key={ending.id}
            selected={selected(state, { kind: 'ENDING', id: ending.id })}
            label={ending.title}
            onSelect={() =>
              dispatch({ type: 'ITEM_SELECTED', selection: { kind: 'ENDING', id: ending.id } })
            }
            onUp={
              index > 0
                ? () => dispatch({ type: 'ENDING_MOVED', endingId: ending.id, index: index - 1 })
                : undefined
            }
            onDown={
              index < state.document.endings.length - 1
                ? () => dispatch({ type: 'ENDING_MOVED', endingId: ending.id, index: index + 1 })
                : undefined
            }
            onDelete={
              state.document.endings.length > 1
                ? () => dispatch({ type: 'ENDING_DELETED', endingId: ending.id })
                : undefined
            }
          />
        ))}
        <Button
          fullWidth
          size="small"
          startIcon={<AddIcon />}
          onClick={() => dispatch({ type: 'ENDING_ADDED' })}
          sx={{ minHeight: 40, textTransform: 'none' }}
        >
          Добавить завершение
        </Button>
      </Box>
    </Stack>
  )
}
