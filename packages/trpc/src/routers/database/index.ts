import { router } from '../../trpc'

import { sourceRouter } from './source'
import { viewRouter } from './view'
import { propertyRouter } from './property'
import { rowRouter } from './row'
import { cellRouter } from './cell'

// Flat procedure surface (database.getByPage, database.createView, ...) built by
// merging the per-entity sub-routers. The sub-files keep each entity's CRUD
// together (mirroring kanban's folder split) while the public API stays flat.
export const databaseRouter = router({
  // Source
  getByPage: sourceRouter.getByPage,
  repairSource: sourceRouter.repairSource,

  // Views
  listViews: viewRouter.list,
  createView: viewRouter.create,
  updateView: viewRouter.update,
  deleteView: viewRouter.delete,

  // Properties
  listProperties: propertyRouter.list,
  createProperty: propertyRouter.create,
  updateProperty: propertyRouter.update,
  deleteProperty: propertyRouter.delete,
  reorderProperties: propertyRouter.reorder,

  // Rows
  listRows: rowRouter.list,
  createRow: rowRouter.create,
  updateRow: rowRouter.update,
  deleteRow: rowRouter.delete,
  restoreRow: rowRouter.restore,
  reorderRows: rowRouter.reorder,

  // Cells
  updateCellValue: cellRouter.updateValue,
})
