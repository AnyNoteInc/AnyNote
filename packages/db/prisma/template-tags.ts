/** Regimented marketplace tags. Seeded by upsert on `slug`; never user-created. */
export interface TemplateTagSeed {
  slug: string
  name: string
  icon: string // MUI icon component name exported from @repo/ui
  position: number
}

export const TEMPLATE_TAGS: TemplateTagSeed[] = [
  { slug: 'job-search', name: 'Поиск работы', icon: 'WorkOutlineIcon', position: 0 },
  { slug: 'website-building', name: 'Создание сайта', icon: 'LaptopIcon', position: 1 },
  { slug: 'freelance', name: 'Фриланс', icon: 'DashboardIcon', position: 2 },
  { slug: 'student-planner', name: 'Студенческий планер', icon: 'MenuBookIcon', position: 3 },
  { slug: 'marketing', name: 'Маркетинг', icon: 'CampaignIcon', position: 4 },
  { slug: 'career-building', name: 'Карьера', icon: 'WorkOutlineIcon', position: 5 },
  { slug: 'personal-website', name: 'Личный сайт', icon: 'LaptopIcon', position: 6 },
  { slug: 'study-planner', name: 'План обучения', icon: 'BookmarkIcon', position: 7 },
]
