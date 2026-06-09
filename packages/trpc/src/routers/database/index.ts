import { router } from '../../trpc'

import { sourceRouter } from './source'
import { viewRouter } from './view'
import { propertyRouter } from './property'
import { rowRouter } from './row'
import { cellRouter } from './cell'
import { relationRouter } from './relation'
import { accessRouter } from './access'
import { reminderRouter } from './reminder'

// Flat procedure surface (database.getByPage, database.createView, ...) built by
// merging the per-entity sub-routers. The sub-files keep each entity's CRUD
// together (mirroring kanban's folder split) while the public API stays flat.
export const databaseRouter = router({
  // Source
  getByPage: sourceRouter.getByPage,
  getBySourceId: sourceRouter.getBySourceId,
  listSources: sourceRouter.listSources,
  repairSource: sourceRouter.repairSource,

  // Views
  listViews: viewRouter.list,
  createView: viewRouter.create,
  updateView: viewRouter.update,
  duplicateView: viewRouter.duplicate,
  deleteView: viewRouter.delete,

  // Properties
  listProperties: propertyRouter.list,
  createProperty: propertyRouter.create,
  updateProperty: propertyRouter.update,
  deleteProperty: propertyRouter.delete,
  reorderProperties: propertyRouter.reorder,

  // Rows
  listRows: rowRouter.list,
  listGroupedRows: rowRouter.listGrouped,
  createRow: rowRouter.create,
  updateRow: rowRouter.update,
  deleteRow: rowRouter.delete,
  restoreRow: rowRouter.restore,
  reorderRows: rowRouter.reorder,
  setRowPosition: rowRouter.setPosition,

  // Cells
  updateCellValue: cellRouter.updateValue,

  // Relations + computed-property helpers
  setRelationLinks: relationRouter.setRelationLinks,
  listLinkableRows: relationRouter.listLinkableRows,
  validateFormula: relationRouter.validateFormula,

  // Page-level access rules + structure lock (Phase 4C)
  listAccessRules: accessRouter.listRules,
  createAccessRule: accessRouter.createRule,
  updateAccessRule: accessRouter.updateRule,
  deleteAccessRule: accessRouter.deleteRule,
  setStructureLocked: accessRouter.setStructureLocked,

  // Self-targeted DATE-cell reminders (Phase 5, 5.4)
  setDatabaseDateReminder: reminderRouter.setDatabaseDateReminder,
  clearDatabaseDateReminder: reminderRouter.clearDatabaseDateReminder,
  getDatabaseDateReminder: reminderRouter.getDatabaseDateReminder,
})
