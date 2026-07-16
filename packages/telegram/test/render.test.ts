import { WEBHOOK_EVENT_TYPES } from '@repo/webhooks'
import { describe, expect, it } from 'vitest'

import {
  escapeHtml,
  renderDenied,
  renderEventMessage,
  renderHelp,
  renderNotFound,
  renderNotLinked,
  renderSearchResults,
} from '../src/render.ts'

const PAGE_URL = 'https://app.example/pages/0197a0aa-0000-7000-8000-000000000001'

describe('escapeHtml', () => {
  it('escapes &, <, >, " and \'', () => {
    expect(escapeHtml(`<b>&"x"'</b>`)).toBe('&lt;b&gt;&amp;&quot;x&quot;&#39;&lt;/b&gt;')
  })

  it('leaves plain text untouched', () => {
    expect(escapeHtml('Обычный заголовок 42')).toBe('Обычный заголовок 42')
  })
})

describe('renderEventMessage', () => {
  it('covers every catalog event type with a distinct Russian one-liner', () => {
    const messages = WEBHOOK_EVENT_TYPES.map((eventType) =>
      renderEventMessage({ eventType, pageTitle: 'Док', pageUrl: PAGE_URL, actorName: null }),
    )
    expect(messages).toHaveLength(9)
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0)
      expect(message).toContain(`<a href="${PAGE_URL}">Док</a>`)
      expect(message).toMatch(/[А-Яа-яЁё]/)
    }
    expect(new Set(messages).size).toBe(WEBHOOK_EVENT_TYPES.length)
  })

  it('escapes malicious titles so they cannot inject HTML', () => {
    const message = renderEventMessage({
      eventType: 'page.created',
      pageTitle: '<b onclick="x">Evil</b>',
      pageUrl: PAGE_URL,
      actorName: null,
    })
    expect(message).not.toContain('<b onclick')
    expect(message).toContain('&lt;b onclick=&quot;x&quot;&gt;Evil&lt;/b&gt;')
  })

  it('escapes the page URL in the href attribute', () => {
    const message = renderEventMessage({
      eventType: 'page.created',
      pageTitle: 'Док',
      pageUrl: 'https://app.example/pages/x?a=1&b="2"',
      actorName: null,
    })
    expect(message).toContain('href="https://app.example/pages/x?a=1&amp;b=&quot;2&quot;"')
  })

  it('appends the actor name when present, escaped', () => {
    const message = renderEventMessage({
      eventType: 'comment.created',
      pageTitle: 'Док',
      pageUrl: PAGE_URL,
      actorName: '<i>Мария</i>',
    })
    expect(message).toContain('&lt;i&gt;Мария&lt;/i&gt;')
    expect(message).not.toContain('<i>Мария</i>')
  })

  it('omits the actor suffix when actorName is null', () => {
    const message = renderEventMessage({
      eventType: 'page.created',
      pageTitle: 'Док',
      pageUrl: PAGE_URL,
      actorName: null,
    })
    expect(message).not.toContain('—')
  })
})

describe('renderSearchResults', () => {
  it('lists items as anchors with escaped titles', () => {
    const text = renderSearchResults([
      { title: '<script>x</script>', url: PAGE_URL },
      { title: 'План', url: 'https://app.example/pages/2' },
    ])
    expect(text).toContain(`<a href="${PAGE_URL}">&lt;script&gt;x&lt;/script&gt;</a>`)
    expect(text).toContain('<a href="https://app.example/pages/2">План</a>')
    expect(text).not.toContain('<script>')
  })

  it('reports an empty result set in Russian', () => {
    const text = renderSearchResults([])
    expect(text.length).toBeGreaterThan(0)
    expect(text).toMatch(/[А-Яа-яЁё]/)
    expect(text).not.toContain('<a ')
  })
})

describe('static replies', () => {
  it('renderHelp lists every command', () => {
    const help = renderHelp()
    for (const command of ['/help', '/link', '/search', '/get']) {
      expect(help).toContain(command)
    }
  })

  it('renderNotFound / renderNotLinked / renderDenied are non-empty Russian one-liners', () => {
    for (const text of [renderNotFound(), renderNotLinked(), renderDenied()]) {
      expect(text.length).toBeGreaterThan(0)
      expect(text).toMatch(/[А-Яа-яЁё]/)
    }
  })

  it('renderNotLinked mentions /link', () => {
    expect(renderNotLinked()).toContain('/link')
  })
})
