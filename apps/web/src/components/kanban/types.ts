export type DateInput = Date | string | null

export interface BoardMember {
  userId: string
  role: string
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
  }
}

export interface BoardColumnRow {
  id: string
  pageId: string
  title: string
  kind: 'ACTIVE' | 'DONE' | 'CANCELLED'
  position: number
  color: string | null
}

export interface BoardLabelRow {
  id: string
  name: string
  color: string
  position: number
}

export interface BoardTaskData {
  id: string
  pageId: string
  columnId: string
  typeId: string | null
  priorityId: string | null
  sprintId: string | null
  parentId: string | null
  title: string
  description: unknown
  startDate: DateInput
  dueDate: DateInput
  position: number
  sprintPosition: number | null
  archived: boolean
  deletedAt: DateInput
  createdById: string
  assignees: Array<{
    userId: string
    user: { id: string; firstName: string | null; lastName: string | null; email: string }
  }>
  labels: Array<{ labelId: string; label: BoardLabelRow }>
}

export interface BoardData {
  columns: BoardColumnRow[]
  types: Array<{ id: string; title: string; position: number }>
  priorities: Array<{ id: string; title: string; position: number; color: string | null }>
  labels: BoardLabelRow[]
  sprints: Array<{
    id: string
    name: string
    status: string
    position: number
    description: string | null
    startDate: Date | string | null
    endDate: Date | string | null
  }>
  tasks: BoardTaskData[]
  members: BoardMember[]
  currentUserId: string
  workspaceId: string
}

export type BoardColumnWithTasks = BoardColumnRow & { tasks: BoardTaskData[] }
