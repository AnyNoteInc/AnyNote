import { router } from '../../trpc'

import { boardRouter } from './board'
import { columnRouter } from './column'
import { typeRouter } from './type'
import { priorityRouter } from './priority'
import { labelRouter } from './label'
import { taskRouter } from './task'
import { eventsRouter } from './events'

export const kanbanRouter = router({
  board: boardRouter,
  column: columnRouter,
  type: typeRouter,
  priority: priorityRouter,
  label: labelRouter,
  task: taskRouter,
  events: eventsRouter,
})
