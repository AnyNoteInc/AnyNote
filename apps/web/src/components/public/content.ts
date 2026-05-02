export const publicFooterSections = [
  {
    title: 'Продукт',
    links: [
      { label: 'Возможности', href: '/#features' },
      { label: 'Тарифы', href: '/pricing' },
      { label: 'Roadmap', href: '/roadmap' },
    ],
  },
  {
    title: 'Компания',
    links: [
      { label: 'Контакты', href: '/contact' },
      { label: 'Оферта', href: '/oferta' },
      { label: 'Политика', href: '/privacy' },
    ],
  },
] as const

export const publicNavItems = [
  { label: 'Цены', href: '/pricing' },
  { label: 'Разработчикам', href: '/developers' },
  { label: 'Планы', href: '/roadmap' },
] as const

export const pricingCards = [
  {
    title: 'Free',
    price: '0',
    description: 'Для личной базы знаний, заметок и первого знакомства с ИИ-поиском.',
    items: ['До 3 пространств', 'Базовый markdown-editor', 'Публичные ссылки'],
  },
  {
    title: 'Персональный',
    price: '12',
    description:
      'Для экспертов и маленьких команд, которым нужна система вместо разрозненных файлов.',
    items: ['ИИ prompt actions', 'RAG-поиск', 'Медиа и вложения'],
  },
  {
    title: 'Компания',
    price: 'Custom',
    description: 'Для команд, которым нужны on-prem, аудит, SSO и внутренний knowledge backbone.',
    items: ['On-Prem', 'Расширенные права доступа', 'Выделенная поддержка'],
  },
] as const

export const landingPricingCards = [
  {
    slug: 'personal',
    name: 'Персональный',
    price: 'Бесплатно',
    features: ['1 рабочее пространство', 'Базовый редактор'],
  },
  {
    slug: 'pro',
    name: 'ПРО',
    price: 'от 150 ₽/мес',
    features: ['3 пространства', 'До 5 участников', 'Чаты с ИИ', 'Индексация'],
  },
  {
    slug: 'max',
    name: 'МАКС',
    price: 'от 1500 ₽/мес',
    features: ['∞ пространств', 'До 100 участников', 'Все модели GigaChat', 'MCP-серверы'],
  },
  {
    slug: 'custom',
    name: 'Собственная инфраструктура',
    price: 'Связаться',
    features: ['Self-hosted', 'SLA', 'Индивидуальные интеграции'],
  },
] as const

export const homeFeatures = [
  {
    icon: '⚡',
    title: 'Мгновенный редактор',
    body: 'Документы и холсты открываются за доли секунды — Tiptap и кеш страниц вместо ожидания загрузки.',
  },
  {
    icon: '🤝',
    title: 'Несколько курсоров на странице',
    body: 'Команда редактирует одну страницу одновременно — без конфликтов и пересохранений.',
  },
  {
    icon: '🌗',
    title: 'Светлая и тёмная тема',
    body: 'Интерфейс адаптируется под систему или переключается вручную — глаза не устают в любое время.',
  },
  {
    icon: '🔐',
    title: 'Гранулярные права',
    body: 'Чтение или запись для участников, групп и гостей — каждому даёте ровно столько доступа, сколько нужно.',
  },
  {
    icon: '🔗',
    title: 'Публичные ссылки',
    body: 'Откройте страницу одной ссылкой — без регистрации для читателя и без рассылок «вот файл в почту».',
  },
  {
    icon: '🛡️',
    title: 'Без санкционных рисков',
    body: 'Российский хостинг и корпоративное развертывание — продукт работает в любой ситуации, ваши данные остаются у вас.',
  },
] as const

export const publicContact = {
  email: 'hello@anynote.app',
  phone: '+7 (495) 123-45-67',
  telegram: '@anynote_support',
} as const

export const integrationCards = [
  {
    title: 'Yandex',
    eyebrow: 'Экосистема в одном контуре',
    description:
      'Вход через Yandex, почта, Диск и документы команды в знакомой для российского рынка инфраструктуре.',
    highlights: ['Yandex ID', 'Почта и Диск', 'Документы и календари'],
  },
  {
    title: 'AmoCRM',
    eyebrow: 'Продажи и знания',
    description:
      'Связка карточек сделок, заметок менеджеров и внутренних регламентов для сопровождения клиентского цикла.',
    highlights: ['Контакты и сделки', 'История коммуникаций', 'Автоматизация продаж'],
  },
  {
    title: 'Bitrix24',
    eyebrow: 'Портал для больших команд',
    description:
      'Интеграция задач, CRM и корпоративной базы знаний там, где Bitrix24 уже является центральной системой.',
    highlights: ['CRM и задачи', 'Корпоративный портал', 'Сделки и процессы'],
  },
  {
    title: 'MangoOffice',
    eyebrow: 'Телефония и сервис',
    description:
      'Привязка звонков, сценариев обработки обращений и скриптов продаж к единому knowledge workspace.',
    highlights: ['Облачная телефония', 'Записи звонков', 'Операторы и очереди'],
  },
] as const

export const roadmapItems = [
  'Запуск редактора текста',
  'ИИ умный поиск на RAG',
  'Интеграция с AmoCRM',
  'Интеграция с bitrix24',
  'Интеграция с MangoOffice телефонией',
] as const
