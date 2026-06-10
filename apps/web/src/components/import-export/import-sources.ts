export type ImportSourceKey = 'GENERIC' | 'NOTION' | 'CONFLUENCE' | 'YANDEX_WIKI'

export type SourceCard = {
  key: ImportSourceKey | 'ASANA' | 'MONDAY'
  label: string
  badge: string | null
  description: string
  limitations: string
  accept: string
  enabled: boolean
}

export const SOURCE_CARDS: SourceCard[] = [
  {
    key: 'GENERIC',
    label: 'Файлы',
    badge: null,
    description: 'Markdown/HTML/CSV-файлы или ZIP-архив с папками',
    limitations:
      'Папки становятся деревом страниц; CSV-файл — базой данных; картинки загружаются в хранилище.',
    accept: '.md,.markdown,.html,.htm,.csv,.zip',
    enabled: true,
  },
  {
    key: 'NOTION',
    label: 'Notion',
    badge: null,
    description: 'ZIP-экспорт Notion (Markdown & CSV или HTML)',
    limitations:
      'Комментарии, права и история не переносятся; формулы, связи и rollup станут текстом.',
    accept: '.zip',
    enabled: true,
  },
  {
    key: 'CONFLUENCE',
    label: 'Confluence',
    badge: null,
    description: 'HTML-экспорт пространства Confluence (ZIP)',
    limitations: 'Права, история, комментарии и макросы не переносятся.',
    accept: '.zip',
    enabled: true,
  },
  {
    key: 'YANDEX_WIKI',
    label: 'Яндекс Wiki',
    badge: 'расширение AnyNote',
    description: 'ZIP/Markdown-выгрузка Яндекс Wiki',
    limitations:
      'Импортируется как дерево Markdown-страниц; специфичные блоки Wiki не переносятся.',
    accept: '.md,.markdown,.zip',
    enabled: true,
  },
  {
    key: 'ASANA',
    label: 'Asana',
    badge: 'недоступно в MVP',
    description: 'Импорт по API появится позже',
    limitations: 'Совет: выгрузите проект в CSV и импортируйте его как базу данных («Файлы»).',
    accept: '',
    enabled: false,
  },
  {
    key: 'MONDAY',
    label: 'Monday',
    badge: 'недоступно в MVP',
    description: 'Импорт по API появится позже',
    limitations: 'Совет: выгрузите доску в CSV и импортируйте её как базу данных («Файлы»).',
    accept: '',
    enabled: false,
  },
]
