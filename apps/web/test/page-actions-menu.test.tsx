// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  copyLink: vi.fn(),
  duplicate: vi.fn(),
  openDeleteConfirm: vi.fn(),
  setFullWidth: vi.fn(),
}))

vi.mock('@/hooks/use-page-actions', () => ({
  usePageActions: () => ({
    copyLink: mocks.copyLink,
    duplicate: mocks.duplicate,
    openDeleteConfirm: mocks.openDeleteConfirm,
    dialogs: null,
  }),
}))

vi.mock('@/hooks/use-full-width', () => ({
  useFullWidth: () => [false, mocks.setFullWidth],
}))

vi.mock('@/components/workspace/move-page-dialog', () => ({
  MovePageDialog: () => null,
}))

vi.mock('@/components/page/page-export-dialog', () => ({
  PageExportDialog: () => null,
}))

vi.mock('@/components/templates', () => ({
  SaveAsTemplateDialog: () => null,
}))

import { PageActionsMenu } from '@/components/page/page-actions-menu'

describe('PageActionsMenu', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('labels the duplicate action as Дублировать', async () => {
    const actor = userEvent.setup()

    render(
      <PageActionsMenu
        pageId="33333333-3333-3333-3333-333333333333"
        pageTitle="Исходная страница"
        pageIcon={null}
        workspaceId="11111111-1111-1111-1111-111111111111"
        pageType="TEXT"
        isFavorite={false}
        movedPage={undefined}
        pages={[]}
      />,
    )

    await actor.click(screen.getByRole('button', { name: 'Действия страницы' }))

    expect(screen.getByRole('menuitem', { name: 'Дублировать' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Копия' })).not.toBeInTheDocument()
  })
})
