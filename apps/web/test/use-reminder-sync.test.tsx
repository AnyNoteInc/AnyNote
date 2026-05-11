import { describe, expect, it } from 'vitest'

import { collectReminderInputs } from '@/components/page/use-reminder-sync'

describe('collectReminderInputs', () => {
  it('skips reminder nodes without an id or dueAt', () => {
    const fakeDoc = {
      descendants(visit: (node: any) => void) {
        visit({ type: { name: 'paragraph' }, attrs: {} })
        visit({ type: { name: 'reminder' }, attrs: { id: '', dueAt: '2026-01-01T00:00:00Z' } })
        visit({ type: { name: 'reminder' }, attrs: { id: 'r1', dueAt: '' } })
        visit({
          type: { name: 'reminder' },
          attrs: {
            id: 'r2',
            dueAt: '2026-06-01T00:00:00Z',
            offsets: [0],
            audience: 'ME',
            label: 'x',
            recipients: [],
            doneAt: null,
          },
        })
      },
    }
    expect(collectReminderInputs(fakeDoc as any)).toEqual([
      {
        id: 'r2',
        dueAt: '2026-06-01T00:00:00Z',
        offsets: [0],
        audience: 'ME',
        label: 'x',
        recipients: [],
        doneAt: null,
      },
    ])
  })
})
