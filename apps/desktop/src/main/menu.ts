import { Menu, type MenuItemConstructorOptions } from 'electron'

export function buildAppMenu(onChangeServer: () => void): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'AnyNote',
      submenu: [
        { label: 'Сменить сервер…', click: () => onChangeServer() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}
