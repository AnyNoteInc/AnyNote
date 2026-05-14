// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ElementMenu } from './ElementMenu'

describe('ElementMenu', () => {
  const anchor = document.createElement('div')

  it('small element shows only generic "Редактировать данные"', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="small"
        personRole="regular"
        bloodRelation="sibling"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные')).toBeInTheDocument()
    expect(screen.queryByText('Добавить партнёра')).not.toBeInTheDocument()
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })

  it('predecessor (direct, !owner) without parents shows predecessor-specific edit + add-partner + add-parents', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="regular"
        bloodRelation="direct"
        hasParents={false}
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные предка')).toBeInTheDocument()
    expect(screen.getByText('Добавить партнёра')).toBeInTheDocument()
    expect(screen.getByText('Добавить родителей')).toBeInTheDocument()
  })

  it('predecessor WITH parents hides "Добавить родителей"', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="regular"
        bloodRelation="direct"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
    expect(screen.getByText('Редактировать данные предка')).toBeInTheDocument()
  })

  it('partner (bloodRelation=partner) shows only partner-specific edit', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="regular"
        bloodRelation="partner"
        hasParents
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(screen.getByText('Редактировать данные партнёра')).toBeInTheDocument()
    expect(screen.queryByText('Добавить партнёра')).not.toBeInTheDocument()
    expect(screen.queryByText('Добавить родителей')).not.toBeInTheDocument()
  })

  it('big owner shows owner-specific menu', () => {
    render(
      <ElementMenu
        open
        anchorEl={anchor}
        personSize="big"
        personRole="owner"
        bloodRelation="direct"
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
