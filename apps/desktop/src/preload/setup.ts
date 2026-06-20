import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('anynoteSetup', {
  connect: (url: string) => ipcRenderer.invoke('anynote:connect', url),
})
