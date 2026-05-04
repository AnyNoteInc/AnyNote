// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ElementMenu } from './ElementMenu'

describe('ElementMenu', () => {
  const anchor = document.createElement('div')

  it('small element shows only "Редактировать данные"', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="small"
        personRole="regular"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные')).toBeInTheDocument()
    expect(screen.queryByText('Добавить партнёра')).not.toBeInTheDocument()
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })

  it('big regular without parents shows three items', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="regular"
        hasParents={false}
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные')).toBeInTheDocument()
    expect(screen.getByText('Добавить партнёра')).toBeInTheDocument()
    expect(screen.getByText('Добавить родителей')).toBeInTheDocument()
  })

  it('big regular WITH parents hides "Добавить родителей"', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="regular"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })

  it('big owner shows owner-specific menu', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="owner"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные владельца')).toBeInTheDocument()
    expect(screen.getByText('Добавить партнёра')).toBeInTheDocument()
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })
})
