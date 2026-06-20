import { app, BrowserWindow, ipcMain, Menu, net, session } from 'electron'
import { clearServerUrl, getServerUrl, setServerUrl } from './config'
import { pingHealth } from './health-check'
import { isValidServerUrl, normalizeServerUrl } from './server-url'
import { buildAppMenu } from './menu'
import { initAutoUpdates } from './updater'
import { createMainWindow, createSelectionWindow } from './window'

let currentWindow: BrowserWindow | null = null

const fetchFn = (url: string, init?: { method?: string }) =>
  net.fetch(url, init) as unknown as Promise<Response>

function showMain(serverUrl: string): void {
  currentWindow?.close()
  currentWindow = createMainWindow(serverUrl)
}

function showSelection(): void {
  currentWindow?.close()
  currentWindow = createSelectionWindow()
}

async function changeServer(): Promise<void> {
  clearServerUrl()
  await session.fromPartition('persist:anynote').clearStorageData()
  showSelection()
}

ipcMain.handle('anynote:connect', async (_event, raw: string) => {
  if (!isValidServerUrl(raw)) return { ok: false, error: 'Некорректный адрес' }
  const url = normalizeServerUrl(raw)
  const ok = await pingHealth(url, fetchFn)
  if (!ok) return { ok: false, error: 'Сервер недоступен' }
  setServerUrl(url)
  showMain(url)
  return { ok: true }
})

ipcMain.on('anynote:change-server', () => void changeServer())

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildAppMenu(() => void changeServer()))
  initAutoUpdates()
  const saved = getServerUrl()
  if (saved) showMain(saved)
  else showSelection()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const url = getServerUrl()
      if (url) showMain(url)
      else showSelection()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
