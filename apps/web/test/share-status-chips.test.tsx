// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ShareStatusChips, type ShareChipModel } from '@/components/page/share-status-chips'

function makeShare(over: Partial<ShareChipModel> = {}): ShareChipModel {
  return {
    access: 'RESTRICTED',
    mode: 'LINK',
    expiresAt: null,
    publishedAt: null,
    unpublishedAt: null,
    allowIndexing: false,
    allowCopy: false,
    publishSubpages: true,
    hasPassword: false,
    exposesAt: null,
    ...over,
  }
}

afterEach(cleanup)

describe('ShareStatusChips', () => {
  it('renders nothing when the page is fully private with no settings', () => {
    const { container } = render(<ShareStatusChips share={makeShare()} />)
    // RESTRICTED + LINK + publishSubpages default => no chips worth showing.
    expect(container.querySelectorAll('.MuiChip-root')).toHaveLength(0)
  })

  it('shows the link-enabled chip when access is PUBLIC', () => {
    render(<ShareStatusChips share={makeShare({ access: 'PUBLIC' })} />)
    expect(screen.getByText('Ссылка включена')).toBeInTheDocument()
  })

  it('shows the link-expires chip when expiresAt is set', () => {
    render(
      <ShareStatusChips
        share={makeShare({ access: 'PUBLIC', expiresAt: '2026-12-31T00:00:00.000Z' })}
      />,
    )
    expect(screen.getByText(/Срок действия ссылки/)).toBeInTheDocument()
  })

  it('shows the published + indexing-on + copy-allowed chips for a published indexed copyable site', () => {
    render(
      <ShareStatusChips
        share={makeShare({
          mode: 'SITE',
          publishedAt: '2026-06-01T00:00:00.000Z',
          allowIndexing: true,
          allowCopy: true,
        })}
      />,
    )
    expect(screen.getByText('Сайт опубликован')).toBeInTheDocument()
    expect(screen.getByText('Индексация включена')).toBeInTheDocument()
    expect(screen.getByText('Копирование разрешено')).toBeInTheDocument()
  })

  it('shows indexing-off when published but allowIndexing is false', () => {
    render(
      <ShareStatusChips
        share={makeShare({ mode: 'SITE', publishedAt: '2026-06-01T00:00:00.000Z' })}
      />,
    )
    expect(screen.getByText('Индексация выключена')).toBeInTheDocument()
  })

  it('shows the subpages-published chip when a published site publishes subpages', () => {
    render(
      <ShareStatusChips
        share={makeShare({
          mode: 'SITE',
          publishedAt: '2026-06-01T00:00:00.000Z',
          publishSubpages: true,
        })}
      />,
    )
    expect(screen.getByText('Подстраницы публикуются')).toBeInTheDocument()
  })

  it('shows the password-protected and scheduled chips (AnyNote extensions)', () => {
    render(
      <ShareStatusChips
        share={makeShare({
          mode: 'SITE',
          publishedAt: '2026-06-01T00:00:00.000Z',
          hasPassword: true,
          exposesAt: '2030-01-01T00:00:00.000Z',
        })}
      />,
    )
    expect(screen.getByText('Защищено паролем')).toBeInTheDocument()
    expect(screen.getByText(/Запланировано/)).toBeInTheDocument()
  })

  it('does not show the published chip after unpublish', () => {
    render(
      <ShareStatusChips
        share={makeShare({
          mode: 'SITE',
          publishedAt: '2026-06-01T00:00:00.000Z',
          unpublishedAt: '2026-06-05T00:00:00.000Z',
        })}
      />,
    )
    expect(screen.queryByText('Сайт опубликован')).not.toBeInTheDocument()
  })
})
