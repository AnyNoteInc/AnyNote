import { autoUpdater } from 'electron-updater'

export function initAutoUpdates(): void {
  autoUpdater.autoDownload = true
  autoUpdater.on('error', (err) => console.error('[updater]', err))
  void autoUpdater.checkForUpdatesAndNotify()
}
