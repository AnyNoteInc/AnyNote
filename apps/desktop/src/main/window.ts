import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { buildDesktopUserAgent } from './user-agent'

const PARTITION = 'persist:anynote'

function applyUserAgent(win: BrowserWindow): void {
  const base = win.webContents.getUserAgent()
  win.webContents.setUserAgent(
    buildDesktopUserAgent(base, {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    }),
  )
}

export function createMainWindow(serverUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 940,
    minHeight: 600,
    webPreferences: {
      partition: PARTITION,
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--anynote-version=${app.getVersion()}`],
    },
  })
  applyUserAgent(win)
  const serverOrigin = new URL(serverUrl).origin
  win.webContents.setWindowOpenHandler(({ url }) => {
    let sameOrigin = false
    try {
      sameOrigin = new URL(url).origin === serverOrigin
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })
  void win.loadURL(serverUrl)
  return win
}

export function createSelectionWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  void win.loadFile(join(__dirname, '../renderer/selection.html'))
  return win
}
