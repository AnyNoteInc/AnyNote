import { contextBridge, ipcRenderer } from 'electron'
import { buildAnynoteApi } from './api'

// The main process injects --anynote-version=<v> via webPreferences.additionalArguments (Task 8).
const versionArg = process.argv.find((a) => a.startsWith('--anynote-version='))
const version = versionArg ? (versionArg.split('=')[1] ?? '0.0.0') : '0.0.0'

contextBridge.exposeInMainWorld(
  'anynote',
  buildAnynoteApi({ platform: process.platform, arch: process.arch, version }),
)
contextBridge.exposeInMainWorld('anynoteBridge', {
  changeServer: () => ipcRenderer.send('anynote:change-server'),
})
