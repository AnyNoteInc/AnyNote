export const publicFooterSections = [
  {
    title: "Продукт",
    links: [
      { label: "Документация", href: "/docs" },
      { label: "Цены", href: "/pricing" },
      { label: "Для разработчиков", href: "/developers" },
    ],
  },
  {
    title: "Сообщество",
    links: [
      { label: "Контакты", href: "/contact" },
      { label: "Наши планы", href: "/roadmap" },
    ],
  },
  {
    title: "Компания",
    links: [
      { label: "Политика конфиденциальности", href: "/privacy" },
      { label: "Пользовательское соглашение", href: "/terms" },
      { label: "Договор-оферта", href: "/oferta" },
    ],
  },
] as const

export const publicNavItems = [
  { label: "Документация", href: "/docs" },
  { label: "Цены", href: "/pricing" },
  { label: "Разработчикам", href: "/developers" },
  { label: "Планы", href: "/roadmap" },
] as const

export const pricingCards = [
  {
    title: "Free",
    price: "0",
    description: "Для личной базы знаний, заметок и первого знакомства с AI-поиском.",
    items: ["До 3 пространств", "Базовый markdown-editor", "Публичные ссылки"],
  },
  {
    title: "Персональный",
    price: "12",
    description:
      "Для экспертов и маленьких команд, которым нужна система вместо разрозненных файлов.",
    items: ["AI prompt actions", "RAG-поиск", "Медиа и вложения"],
  },
  {
    title: "Компания",
    price: "Custom",
    description: "Для команд, которым нужны on-prem, аудит, SSO и внутренний knowledge backbone.",
    items: ["On-Prem", "Расширенные права доступа", "Выделенная поддержка"],
  },
] as const

export const landingPricingCards = [
  {
    slug: "personal",
    name: "Personal",
    price: "Бесплатно",
    features: ["1 рабочее пространство", "Базовый редактор"],
  },
  {
    slug: "pro",
    name: "Pro",
    price: "от 150 ₽/мес",
    features: ["3 пространства", "До 5 участников", "Чаты с AI", "Индексация"],
  },
  {
    slug: "max",
    name: "Max",
    price: "от 1500 ₽/мес",
    features: ["∞ пространств", "До 100 участников", "Все модели GigaChat", "MCP-серверы"],
  },
  {
    slug: "custom",
    name: "Собственная инфраструктура",
    price: "Связаться",
    features: ["Self-hosted", "SLA", "Индивидуальные интеграции"],
  },
] as const

export const integrationCards = [
  {
    title: "Yandex",
    eyebrow: "Экосистема в одном контуре",
    description:
      "Вход через Yandex, почта, Диск и документы команды в знакомой для российского рынка инфраструктуре.",
    highlights: ["Yandex ID", "Почта и Диск", "Документы и календари"],
  },
  {
    title: "AmoCRM",
    eyebrow: "Продажи и знания",
    description:
      "Связка карточек сделок, заметок менеджеров и внутренних регламентов для сопровождения клиентского цикла.",
    highlights: ["Контакты и сделки", "История коммуникаций", "Автоматизация продаж"],
  },
  {
    title: "Bitrix24",
    eyebrow: "Портал для больших команд",
    description:
      "Интеграция задач, CRM и корпоративной базы знаний там, где Bitrix24 уже является центральной системой.",
    highlights: ["CRM и задачи", "Корпоративный портал", "Сделки и процессы"],
  },
  {
    title: "MangoOffice",
    eyebrow: "Телефония и сервис",
    description:
      "Привязка звонков, сценариев обработки обращений и скриптов продаж к единому knowledge workspace.",
    highlights: ["Облачная телефония", "Записи звонков", "Операторы и очереди"],
  },
] as const

export const roadmapItems = [
  "Запуск редактора текста",
  "AI умный поиск на RAG",
  "Интеграция с AmoCRM",
  "Интеграция с bitrix24",
  "Интеграция с MangoOffice телефонией",
] as const
