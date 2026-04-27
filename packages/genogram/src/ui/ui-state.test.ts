import { describe, expect, it } from 'vitest'
import { initialUiState, uiReducer } from './ui-state'

describe('uiReducer', () => {
  it('select-node sets menu', () => {
    const state = uiReducer(initialUiState, { type: 'select-node', id: 'n1', anchorEl: {} as HTMLElement })
    expect(state.menu).toEqual({ anchorEl: expect.any(Object), kind: 'node', targetId: 'n1' })
    expect(state.selection).toEqual({ kind: 'node', id: 'n1' })
  })

  it('open-drawer closes menu', () => {
    let state = uiReducer(initialUiState, { type: 'select-node', id: 'n1', anchorEl: {} as HTMLElement })
    state = uiReducer(state, { type: 'open-drawer', drawer: { mode: 'edit-data', personId: 'n1' as never } })
    expect(state.menu).toBeNull()
    expect(state.drawer.mode).toBe('edit-data')
  })

  it('cancel resets drawer to closed and menu to null', () => {
    let state = uiReducer(initialUiState, { type: 'open-drawer', drawer: { mode: 'edit-data', personId: 'n1' as never } })
    state = uiReducer(state, { type: 'cancel' })
    expect(state.drawer.mode).toBe('closed')
    expect(state.menu).toBeNull()
  })

  it('open-create transitions to create-genogram drawer', () => {
    const state = uiReducer(initialUiState, { type: 'open-create' })
    expect(state.drawer.mode).toBe('create-genogram')
  })
})
