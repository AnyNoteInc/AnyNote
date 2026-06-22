import Store from 'electron-store'

type Schema = { serverUrl?: string }

// electron-store → conf needs a `projectName` to compute its storage path. In
// the esbuild bundle, conf's package.json walk-up doesn't resolve to our app,
// so we pass it explicitly. The type excludes `projectName` (conf normally
// derives it from app.getName()), so we widen the options at the call site.
// The store is created lazily on first access so construction happens after
// app.whenReady() (electron-store reads app.getPath('userData') eagerly).
type StoreOptions = NonNullable<ConstructorParameters<typeof Store<Schema>>[0]>

let store: Store<Schema> | undefined

function getStore(): Store<Schema> {
  // `projectName` is a real conf option that electron-store's type omits.
  const options = { name: 'anynote-desktop', projectName: 'anynote-desktop' } as StoreOptions
  store ??= new Store<Schema>(options)
  return store
}

export function getServerUrl(): string | undefined {
  return getStore().get('serverUrl')
}

export function setServerUrl(url: string): void {
  getStore().set('serverUrl', url)
}

export function clearServerUrl(): void {
  getStore().delete('serverUrl')
}
