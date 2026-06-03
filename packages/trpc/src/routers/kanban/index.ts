import { router } from '../../trpc'

import { boardRouter } from './board'
import { columnRouter } from './column'
import { typeRouter } from './type'
import { priorityRouter } from './priority'
import { labelRouter } from './label'
import { sprintRouter } from './sprint'
import { taskRouter } from './task'
import { participantRouter } from './participant'
import { commentRouter } from './comment'
import { attachmentRouter } from './attachment'
import { eventsRouter } from './events'

export const kanbanRouter = router({
  board: boardRouter,
  column: columnRouter,
  type: typeRouter,
  priority: priorityRouter,
  label: labelRouter,
  sprint: sprintRouter,
  task: taskRouter,
  participant: participantRouter,
  comment: commentRouter,
  attachment: attachmentRouter,
  events: eventsRouter,
})
