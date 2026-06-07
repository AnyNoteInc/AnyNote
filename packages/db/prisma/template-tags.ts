/** Regimented marketplace tags. Seeded by upsert on `slug`; never user-created. */
export interface TemplateTagSeed {
  slug: string
  name: string
  icon: string // MUI icon component name exported from @repo/ui
  position: number
}

export const TEMPLATE_TAGS: TemplateTagSeed[] = [
  { slug: 'job-search', name: 'Job Search', icon: 'WorkOutlineIcon', position: 0 },
  { slug: 'website-building', name: 'Website Building', icon: 'LaptopIcon', position: 1 },
  { slug: 'freelance', name: 'Freelance', icon: 'DashboardIcon', position: 2 },
  { slug: 'student-planner', name: 'Student Planner', icon: 'MenuBookIcon', position: 3 },
  { slug: 'marketing', name: 'Marketing', icon: 'CampaignIcon', position: 4 },
  { slug: 'career-building', name: 'Career Building', icon: 'WorkOutlineIcon', position: 5 },
  { slug: 'personal-website', name: 'Personal Website', icon: 'LaptopIcon', position: 6 },
  { slug: 'study-planner', name: 'Study Planner', icon: 'BookmarkIcon', position: 7 },
]
