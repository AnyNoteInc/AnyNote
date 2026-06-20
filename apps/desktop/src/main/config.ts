import Store from 'electron-store'

type Schema = { serverUrl?: string }

const store = new Store<Schema>({ name: 'anynote-desktop' })

export function getServerUrl(): string | undefined {
  return store.get('serverUrl')
}

export function setServerUrl(url: string): void {
  store.set('serverUrl', url)
}

export function clearServerUrl(): void {
  store.delete('serverUrl')
}
