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
  startDate: Date | string | null
  dueDate: Date | string | null
  position: number
  archived: boolean
  deletedAt: Date | string | null
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
  priorities: Array<{ id: string; title: string; position: number }>
  labels: BoardLabelRow[]
  sprints: Array<{ id: string; name: string; status: string; position: number }>
  tasks: BoardTaskData[]
  members: BoardMember[]
}

export type BoardColumnWithTasks = BoardColumnRow & { tasks: BoardTaskData[] }
