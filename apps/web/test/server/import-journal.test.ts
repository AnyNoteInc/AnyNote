import { describe, expect, it } from 'vitest'

import { ImportJournal } from '../../src/server/page-import/journal'

describe('ImportJournal', () => {
  it('accumulates actions/warnings/skips and renders a readable log', () => {
    const j = new ImportJournal('NOTION', 'export.zip')
    j.action('Создана страница «Проект»')
    j.warn('Колонка «Формула» импортирована как текст')
    j.skip('Пропущен файл «x.pdf»')
    expect(j.warnings).toEqual([
      'Колонка «Формула» импортирована как текст',
      'Пропущен файл «x.pdf»',
    ])
    const text = j.render()
    expect(text).toContain('Источник: NOTION')
    expect(text).toContain('export.zip')
    expect(text).toContain('[ok] Создана страница «Проект»')
    expect(text).toContain('[!] Колонка')
    expect(text).toContain('[skip] Пропущен')
  })
})
