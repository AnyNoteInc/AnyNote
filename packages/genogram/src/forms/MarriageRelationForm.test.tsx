// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MarriageRelationForm } from './MarriageRelationForm'

describe('MarriageRelationForm', () => {
  it('marriage default — shows wedding date and divorced checkbox', () => {
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Дата свадьбы')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Брак расторгнут' })).toBeInTheDocument()
  })

  it('shows divorce date when divorced toggled', async () => {
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Брак расторгнут' }))
    expect(screen.getByText('Дата развода')).toBeInTheDocument()
  })

  it('cohabitation — shows start date and ended checkbox', async () => {
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Отношения' }))
    expect(screen.getByText('Дата начала')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Отношения закончены' })).toBeInTheDocument()
  })

  it('submit emits union draft with divorce', async () => {
    const onSubmit = vi.fn()
    render(
      <MarriageRelationForm
        initial={{ kind: 'marriage' }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('checkbox', { name: 'Брак расторгнут' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'marriage',
        divorce: expect.any(Object),
      }),
    )
  })
})
