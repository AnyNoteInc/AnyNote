import { describe, expect, it } from 'vitest'
import { parseAiProviderConnection } from './ai-provider-connection.ts'

describe('parseAiProviderConnection', () => {
  it('parses Ollama with explicit provider key', () => {
    expect(
      parseAiProviderConnection('ollama', { provider: 'ollama', baseUrl: 'http://x:11434' }),
    ).toEqual({
      provider: 'ollama',
      baseUrl: 'http://x:11434',
    })
  })

  it('parses Ollama when provider key is missing (uses providerSlug)', () => {
    expect(parseAiProviderConnection('ollama', { baseUrl: 'http://x:11434' })).toEqual({
      provider: 'ollama',
      baseUrl: 'http://x:11434',
    })
  })

  it('parses OpenAI', () => {
    expect(parseAiProviderConnection('openai', { apiKey: 'sk-x', organization: 'org' })).toEqual({
      provider: 'openai',
      apiKey: 'sk-x',
      organization: 'org',
    })
  })

  it('parses GigaChat', () => {
    expect(
      parseAiProviderConnection('gigachat', {
        clientId: 'a',
        clientSecret: 'b',
        scope: 'GIGACHAT_API_PERS',
      }),
    ).toEqual({
      provider: 'gigachat',
      clientId: 'a',
      clientSecret: 'b',
      scope: 'GIGACHAT_API_PERS',
    })
  })

  it('throws on unknown provider', () => {
    expect(() => parseAiProviderConnection('mystery', {})).toThrow(/unknown provider/i)
  })

  it('throws on invalid Ollama (missing baseUrl)', () => {
    expect(() => parseAiProviderConnection('ollama', {})).toThrow()
  })

  it('parses an anthropic apiKey connection', () => {
    const c = parseAiProviderConnection('anthropic', { apiKey: 'sk-ant' })
    expect(c).toEqual({ provider: 'anthropic', apiKey: 'sk-ant' })
  })

  it('requires folderId for yandexgpt', () => {
    expect(() => parseAiProviderConnection('yandexgpt', { apiKey: 'k' })).toThrow()
  })

  it('parses a yandexgpt apiKey+folderId connection', () => {
    const c = parseAiProviderConnection('yandexgpt', { apiKey: 'k', folderId: 'b1g' })
    expect(c).toEqual({ provider: 'yandexgpt', apiKey: 'k', folderId: 'b1g' })
  })

  it('parses deepseek with optional baseUrl', () => {
    const c = parseAiProviderConnection('deepseek', { apiKey: 'sk-ds' })
    expect(c).toEqual({ provider: 'deepseek', apiKey: 'sk-ds' })
  })
})
