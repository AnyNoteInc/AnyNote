import type { AnnotationId, PersonId, UnionId } from '../types'

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

export type DrawerState =
  | { mode: 'closed' }
  | { mode: 'create-genogram' }
  | { mode: 'edit-data'; personId: PersonId }
  | { mode: 'edit-owner-data'; personId: PersonId }
  | { mode: 'add-partner'; basePersonId: PersonId }
  | { mode: 'edit-connection'; unionId: UnionId }
  | { mode: 'add-children'; unionId: UnionId }
  | { mode: 'add-note'; position: { x: number; y: number } }
  | { mode: 'edit-note'; annotationId: AnnotationId }

export type Menu =
  | { anchorEl: HTMLElement; kind: 'node'; targetId: string }
  | { anchorEl: HTMLElement; kind: 'edge'; targetId: string }
  | { anchorEl: HTMLElement; kind: 'pane'; position: { x: number; y: number } }
  | { anchorEl: HTMLElement; kind: 'annotation'; targetId: AnnotationId }

export interface UiState {
  selection: Selection
  menu: Menu | null
  drawer: DrawerState
  /** When set, the next pane click commits the annotation's drag position. */
  movingAnnotationId: AnnotationId | null
}

export type UiAction =
  | { type: 'select-node'; id: string; anchorEl: HTMLElement }
  | { type: 'select-edge'; id: string; anchorEl: HTMLElement }
  | {
      type: 'select-annotation'
      id: AnnotationId
      anchorEl: HTMLElement
    }
  | {
      type: 'open-pane-menu'
      anchorEl: HTMLElement
      position: { x: number; y: number }
    }
  | { type: 'close-menu' }
  | { type: 'open-create' }
  | { type: 'open-drawer'; drawer: DrawerState }
  | { type: 'start-move-annotation'; id: AnnotationId }
  | { type: 'stop-move-annotation' }
  | { type: 'cancel' }

export const initialUiState: UiState = {
  selection: null,
  menu: null,
  drawer: { mode: 'closed' },
  movingAnnotationId: null,
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'select-node':
      return {
        ...state,
        selection: { kind: 'node', id: action.id },
        menu: { anchorEl: action.anchorEl, kind: 'node', targetId: action.id },
      }
    case 'select-edge':
      return {
        ...state,
        selection: { kind: 'edge', id: action.id },
        menu: { anchorEl: action.anchorEl, kind: 'edge', targetId: action.id },
      }
    case 'select-annotation':
      return {
        ...state,
        selection: { kind: 'node', id: action.id },
        menu: { anchorEl: action.anchorEl, kind: 'annotation', targetId: action.id },
      }
    case 'open-pane-menu':
      return {
        ...state,
        selection: null,
        menu: { anchorEl: action.anchorEl, kind: 'pane', position: action.position },
      }
    case 'close-menu':
      return { ...state, menu: null }
    case 'open-create':
      return { ...state, menu: null, drawer: { mode: 'create-genogram' } }
    case 'open-drawer':
      return { ...state, menu: null, drawer: action.drawer }
    case 'start-move-annotation':
      return { ...state, menu: null, movingAnnotationId: action.id }
    case 'stop-move-annotation':
      return { ...state, movingAnnotationId: null }
    case 'cancel':
      return {
        ...state,
        menu: null,
        drawer: { mode: 'closed' },
        selection: null,
        movingAnnotationId: null,
      }
  }
}
