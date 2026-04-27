import type { PersonId, UnionId } from '../types/domain'

export type Selection =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null

export type DrawerState =
  | { mode: 'closed' }
  | { mode: 'create-genogram' }
  | { mode: 'edit-data'; personId: PersonId }
  | { mode: 'edit-owner-data'; personId: PersonId }
  | { mode: 'add-partner'; basePersonId: PersonId }
  | { mode: 'edit-connection'; unionId: UnionId }
  | { mode: 'add-children'; unionId: UnionId }

export interface UiState {
  selection: Selection
  menu: { anchorEl: HTMLElement; kind: 'node' | 'edge'; targetId: string } | null
  drawer: DrawerState
}

export type UiAction =
  | { type: 'select-node'; id: string; anchorEl: HTMLElement }
  | { type: 'select-edge'; id: string; anchorEl: HTMLElement }
  | { type: 'close-menu' }
  | { type: 'open-create' }
  | { type: 'open-drawer'; drawer: DrawerState }
  | { type: 'cancel' }

export const initialUiState: UiState = {
  selection: null,
  menu: null,
  drawer: { mode: 'closed' },
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
    case 'close-menu':
      return { ...state, menu: null }
    case 'open-create':
      return { ...state, menu: null, drawer: { mode: 'create-genogram' } }
    case 'open-drawer':
      return { ...state, menu: null, drawer: action.drawer }
    case 'cancel':
      return { ...state, menu: null, drawer: { mode: 'closed' }, selection: null }
  }
}
