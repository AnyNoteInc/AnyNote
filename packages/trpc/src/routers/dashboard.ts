import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import type { PrismaClient } from '@repo/db'
import {
  aggregateWidget,
  dashboardWidgetTypeSchema,
  filterOperatorSchema,
  globalFilterInputSchema,
  widgetConfigSchema,
  MAX_WIDGETS_PER_DASHBOARD,
} from '@repo/domain'
import type {
  DashboardWidgetType,
  FilterOperator,
  GlobalFilterInput,
  WidgetConfig,
  WidgetDataResult,
} from '@repo/domain'

import { router, protectedProcedure } from '../trpc'
import {
  assertWorkspaceMember,
  assertPageAccess,
  assertPageEditAccess,
} from '../helpers/page-access'
import { requireWritableWorkspace } from '../helpers/plan'
import { mapDomain } from '../helpers/map-domain'
import { domain as domainSvc } from '../domain'

// ── Types ─────────────────────────────────────────────────────────────────────

type Ctx = { prisma: PrismaClient; user: { id: string } }

/** A widget as served to clients (the persisted row projected; config is opaque JSON). */
export type DashboardWidgetDto = {
  id: string
  sourceId: string
  viewId: string | null
  type: DashboardWidgetType
  title: string
  config: WidgetConfig
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  position: number
}

/** A persisted global filter projected onto the GlobalFilterInput shape. */
export type DashboardGlobalFilterDto = GlobalFilterInput & { id: string; position: number }

export type DashboardDto = {
  id: string
  pageId: string
  workspaceId: string
  title: string
}

/**
 * The TYPED result `dashboard.getById` / `dashboard.getByPage` return — the union
 * the DASHBOARD page renderer (Task 5) and the dashboard embed switch on.
 * OBJECT-HIDING (spec §7.6, the meeting/synced-block precedent): a non-member /
 * non-page-viewer gets `no_access`, NEVER widget content — the query never throws
 * on no-access so the client can distinguish the placeholder states. `editable`
 * is true when the caller has EDIT access to the DASHBOARD page (so the renderer
 * shows the edit affordances only to editors, spec §7.3).
 */
export type DashboardReadResult =
  | {
      status: 'ok'
      dashboard: DashboardDto
      widgets: DashboardWidgetDto[]
      globalFilters: DashboardGlobalFilterDto[]
      editable: boolean
    }
  | { status: 'no_access' }
  | { status: 'not_found' }

/**
 * The per-widget data union `dashboard.dashboardData` returns. Per-VIEWER (the
 * aggregation runs the row-access authority for THIS caller), object-hiding at
 * the dashboard level: a non-reader gets `no_access` and NO widget data at all
 * (spec §7.1/§7.6). Each widget's result is the domain `WidgetDataResult`
 * (metric/number/grouped/table or no_access/hidden_property/error per widget).
 */
export type DashboardDataResult =
  | { status: 'ok'; widgets: { widgetId: string; result: WidgetDataResult }[] }
  | { status: 'no_access' }
  | { status: 'not_found' }

const NO_ACCESS = { status: 'no_access' } as const
const NOT_FOUND = { status: 'not_found' } as const

// ── Projections ───────────────────────────────────────────────────────────────

type WidgetRow = {
  id: string
  sourceId: string
  viewId: string | null
  type: DashboardWidgetType
  title: string
  config: unknown
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  position: number
}

function projectWidget(w: WidgetRow): DashboardWidgetDto {
  // The persisted config is opaque JSON — coerce defensively (a malformed row
  // degrades to an empty config rather than crashing the read).
  const parsed = widgetConfigSchema.safeParse(w.config)
  return {
    id: w.id,
    sourceId: w.sourceId,
    viewId: w.viewId,
    type: w.type,
    title: w.title,
    config: parsed.success ? parsed.data : {},
    gridX: w.gridX,
    gridY: w.gridY,
    gridW: w.gridW,
    gridH: w.gridH,
    position: w.position,
  }
}

/**
 * Coerce a PERSISTED global-filter operator (free JSON) to the strict
 * FilterOperator enum. New rows are written through `globalFilterInputSchema`
 * (validated), so this is normally a pass-through; a legacy/corrupt operator
 * falls back to `equals` (a defined, harmless no-op for a missing-type cell)
 * rather than smuggling an invalid string into the typed surface.
 */
function asFilterOperator(raw: unknown): FilterOperator {
  const parsed = filterOperatorSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'equals'
}

function projectGlobalFilter(f: {
  id: string
  propertyName: string
  config: unknown
  position: number
}): DashboardGlobalFilterDto {
  const cfg = (f.config && typeof f.config === 'object' ? f.config : {}) as {
    operator?: unknown
    value?: unknown
  }
  return {
    id: f.id,
    position: f.position,
    propertyName: f.propertyName,
    operator: asFilterOperator(cfg.operator),
    value: cfg.value,
  }
}

// ── Access ──────────────────────────────────────────────────────────────────

/**
 * Resolve the caller's access to a dashboard's DASHBOARD page for a READ surface.
 * Returns `{ editable }` (page READ admitted; `editable` = page EDIT admitted) or
 * null for no access — never throws (object-hiding). Dashboard permissions follow
 * the DASHBOARD page (the meeting precedent): a workspace member of the page's
 * workspace is admitted; edit-capability follows the role.
 */
async function resolveDashboardReadAccess(
  ctx: Ctx,
  pageId: string,
): Promise<{ editable: boolean } | null> {
  let page
  try {
    page = await assertPageAccess(ctx, pageId)
  } catch {
    // assertPageAccess throws NOT_FOUND for non-members — degrade to no_access on
    // the read path (the union carries the placeholder; never leak content).
    return null
  }
  if (page.createdById === ctx.user.id) return { editable: true }
  const member = await ctx.prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: page.workspaceId, userId: ctx.user.id } },
    select: { role: true },
  })
  const editable = member?.role === 'OWNER' || member?.role === 'ADMIN' || member?.role === 'EDITOR'
  return { editable }
}

/**
 * Load a widget + its owning dashboard's page, asserting EDIT access on that page.
 * Used by every per-widget mutation (updateWidget/removeWidget). NOT_FOUND for an
 * unknown widget; FORBIDDEN (via assertPageEditAccess) for a viewer.
 */
async function assertWidgetEditAccess(ctx: Ctx, widgetId: string) {
  const widget = await ctx.prisma.dashboardWidget.findUnique({
    where: { id: widgetId },
    select: { id: true, dashboardId: true, dashboard: { select: { pageId: true } } },
  })
  if (!widget) throw new TRPCError({ code: 'NOT_FOUND', message: 'Виджет не найден' })
  await assertPageEditAccess(ctx, widget.dashboard.pageId)
  return widget
}

/**
 * Load a dashboard + its page, asserting EDIT access. Used by the
 * dashboard-scoped mutations (addWidget/updateLayout/setGlobalFilters).
 */
async function assertDashboardEditAccess(ctx: Ctx, dashboardId: string) {
  const dashboard = await ctx.prisma.dashboard.findUnique({
    where: { id: dashboardId },
    select: { id: true, pageId: true, workspaceId: true },
  })
  if (!dashboard) throw new TRPCError({ code: 'NOT_FOUND', message: 'Дашборд не найден' })
  await assertPageEditAccess(ctx, dashboard.pageId)
  return dashboard
}

// ── Router ──────────────────────────────────────────────────────────────────

export const dashboardRouter = router({
  // Create a DASHBOARD page + its Dashboard row. Gated: workspace membership +
  // writable workspace. The page is created through the domain (linked-list
  // positioning + outbox enqueue, the one page-create path); `location: 'team'`
  // makes it a TEAM-collection page (visible to all workspace members).
  create: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        title: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ pageId: string; dashboardId: string }> => {
      await assertWorkspaceMember(ctx, input.workspaceId)
      await requireWritableWorkspace(input.workspaceId)

      const title = input.title ?? 'Дашборд'
      const page = await mapDomain(() =>
        domainSvc.pages.create(ctx.user.id, {
          workspaceId: input.workspaceId,
          parentId: null,
          type: 'DASHBOARD',
          title,
          location: 'team',
        }),
      )
      const dashboard = await ctx.prisma.dashboard.create({
        data: {
          workspaceId: input.workspaceId,
          pageId: page.id,
          title,
          createdById: ctx.user.id,
        },
        select: { id: true },
      })
      return { pageId: page.id, dashboardId: dashboard.id }
    }),

  // Object-hiding read by the owning DASHBOARD page id. Never throws on no-access.
  getByPage: protectedProcedure
    .input(z.object({ pageId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<DashboardReadResult> => {
      const dashboard = await ctx.prisma.dashboard.findUnique({
        where: { pageId: input.pageId },
        select: { id: true, pageId: true, workspaceId: true, title: true },
      })
      if (!dashboard) return NOT_FOUND
      const access = await resolveDashboardReadAccess(ctx, dashboard.pageId)
      if (!access) return NO_ACCESS
      return loadDashboardRead(ctx, dashboard, access.editable)
    }),

  // Object-hiding read by Dashboard id.
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<DashboardReadResult> => {
      const dashboard = await ctx.prisma.dashboard.findUnique({
        where: { id: input.id },
        select: { id: true, pageId: true, workspaceId: true, title: true },
      })
      if (!dashboard) return NOT_FOUND
      const access = await resolveDashboardReadAccess(ctx, dashboard.pageId)
      if (!access) return NO_ACCESS
      return loadDashboardRead(ctx, dashboard, access.editable)
    }),

  // Attach a widget. Edit-gated (a viewer → FORBIDDEN). The source must belong to
  // the dashboard's workspace (else NOT_FOUND — no cross-workspace attach, spec
  // §7.7) AND be readable by the caller (assertPageAccess on the source's page).
  // Rejects beyond MAX_WIDGETS_PER_DASHBOARD (spec §7.5).
  addWidget: protectedProcedure
    .input(
      z.object({
        dashboardId: z.string().uuid(),
        sourceId: z.string().uuid(),
        type: dashboardWidgetTypeSchema,
        title: z.string().trim().max(200).optional(),
        viewId: z.string().uuid().optional(),
        config: widgetConfigSchema.optional(),
        grid: z
          .object({
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            w: z.number().int().min(1),
            h: z.number().int().min(1),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<DashboardWidgetDto> => {
      const dashboard = await assertDashboardEditAccess(ctx, input.dashboardId)

      // Cap (spec §7.5) — count the dashboard's persisted widgets.
      const count = await ctx.prisma.dashboardWidget.count({
        where: { dashboardId: dashboard.id },
      })
      if (count >= MAX_WIDGETS_PER_DASHBOARD) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Превышен лимит виджетов (${MAX_WIDGETS_PER_DASHBOARD})`,
        })
      }

      // Cross-workspace check (spec §7.7): the source must be in the dashboard's
      // workspace. A foreign / unknown source is a uniform NOT_FOUND.
      const source = await ctx.prisma.databaseSource.findFirst({
        where: { id: input.sourceId, workspaceId: dashboard.workspaceId },
        select: { id: true, pageId: true },
      })
      if (!source) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'База данных не найдена' })
      }
      // The source must also be READABLE by the caller (the page-access gate).
      await assertPageAccess(ctx, source.pageId)

      // If a viewId is given it must belong to this source (no foreign view).
      if (input.viewId) {
        const view = await ctx.prisma.databaseView.findFirst({
          where: { id: input.viewId, sourceId: source.id },
          select: { id: true },
        })
        if (!view) throw new TRPCError({ code: 'NOT_FOUND', message: 'Представление не найдено' })
      }

      const widget = await ctx.prisma.dashboardWidget.create({
        data: {
          dashboardId: dashboard.id,
          sourceId: source.id,
          viewId: input.viewId ?? null,
          type: input.type,
          title: input.title ?? '',
          config: (input.config ?? {}) as object,
          position: count,
          ...(input.grid
            ? { gridX: input.grid.x, gridY: input.grid.y, gridW: input.grid.w, gridH: input.grid.h }
            : {}),
        },
      })
      return projectWidget(widget)
    }),

  // Update a widget's title/config/viewId. Edit-gated. A viewId is validated to
  // the widget's source.
  updateWidget: protectedProcedure
    .input(
      z.object({
        widgetId: z.string().uuid(),
        title: z.string().trim().max(200).optional(),
        viewId: z.string().uuid().nullable().optional(),
        config: widgetConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<DashboardWidgetDto> => {
      const existing = await assertWidgetEditAccess(ctx, input.widgetId)
      if (input.viewId) {
        const widgetRow = await ctx.prisma.dashboardWidget.findUniqueOrThrow({
          where: { id: existing.id },
          select: { sourceId: true },
        })
        const view = await ctx.prisma.databaseView.findFirst({
          where: { id: input.viewId, sourceId: widgetRow.sourceId },
          select: { id: true },
        })
        if (!view) throw new TRPCError({ code: 'NOT_FOUND', message: 'Представление не найдено' })
      }
      const widget = await ctx.prisma.dashboardWidget.update({
        where: { id: existing.id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.viewId !== undefined ? { viewId: input.viewId } : {}),
          ...(input.config !== undefined ? { config: input.config as object } : {}),
        },
      })
      return projectWidget(widget)
    }),

  // Remove a widget. Edit-gated. Idempotent — a missing widget is NOT_FOUND.
  removeWidget: protectedProcedure
    .input(z.object({ widgetId: z.string().uuid() }))
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const existing = await assertWidgetEditAccess(ctx, input.widgetId)
      await ctx.prisma.dashboardWidget.delete({ where: { id: existing.id } })
      return { ok: true }
    }),

  // Bulk-persist the grid layout. Edit-gated. Only widget ids that belong to THIS
  // dashboard are applied (a foreign id is silently ignored — never moves another
  // dashboard's widget). Applied in one transaction.
  updateLayout: protectedProcedure
    .input(
      z.object({
        dashboardId: z.string().uuid(),
        layout: z.array(
          z.object({
            id: z.string().uuid(),
            x: z.number().int().min(0),
            y: z.number().int().min(0),
            w: z.number().int().min(1),
            h: z.number().int().min(1),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const dashboard = await assertDashboardEditAccess(ctx, input.dashboardId)
      // Restrict to widgets actually on this dashboard (no cross-dashboard write).
      const ownIds = new Set(
        (
          await ctx.prisma.dashboardWidget.findMany({
            where: { dashboardId: dashboard.id },
            select: { id: true },
          })
        ).map((w) => w.id),
      )
      const updates = input.layout.filter((l) => ownIds.has(l.id))
      if (updates.length > 0) {
        await ctx.prisma.$transaction(
          updates.map((l) =>
            ctx.prisma.dashboardWidget.update({
              where: { id: l.id },
              data: { gridX: l.x, gridY: l.y, gridW: l.w, gridH: l.h },
            }),
          ),
        )
      }
      return { ok: true }
    }),

  // Replace the dashboard's global filters (full set; not append). Edit-gated.
  setGlobalFilters: protectedProcedure
    .input(
      z.object({
        dashboardId: z.string().uuid(),
        filters: z.array(globalFilterInputSchema),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<{ ok: true }> => {
      const dashboard = await assertDashboardEditAccess(ctx, input.dashboardId)
      await ctx.prisma.$transaction([
        ctx.prisma.dashboardGlobalFilter.deleteMany({ where: { dashboardId: dashboard.id } }),
        ...(input.filters.length > 0
          ? [
              ctx.prisma.dashboardGlobalFilter.createMany({
                data: input.filters.map((f, i) => ({
                  dashboardId: dashboard.id,
                  propertyName: f.propertyName,
                  config: { operator: f.operator, value: f.value ?? null } as object,
                  position: i,
                })),
              }),
            ]
          : []),
      ])
      return { ok: true }
    }),

  // Per-viewer widget data. Reads gate on the DASHBOARD page (object-hiding: a
  // non-reader gets `no_access` for the WHOLE dashboard, never any widget data).
  // For each widget call `aggregateWidget` (passing the dashboard's global
  // filters); the per-widget result is itself access-filtered (the row-access
  // authority runs for THIS caller) so it is honestly per-viewer.
  dashboardData: protectedProcedure
    .input(z.object({ dashboardId: z.string().uuid() }))
    .query(async ({ ctx, input }): Promise<DashboardDataResult> => {
      const dashboard = await ctx.prisma.dashboard.findUnique({
        where: { id: input.dashboardId },
        select: { id: true, pageId: true },
      })
      if (!dashboard) return NOT_FOUND
      const access = await resolveDashboardReadAccess(ctx, dashboard.pageId)
      if (!access) return NO_ACCESS

      const [widgets, filterRows] = await Promise.all([
        ctx.prisma.dashboardWidget.findMany({
          where: { dashboardId: dashboard.id },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            sourceId: true,
            viewId: true,
            type: true,
            config: true,
          },
        }),
        ctx.prisma.dashboardGlobalFilter.findMany({
          where: { dashboardId: dashboard.id },
          orderBy: { position: 'asc' },
          select: { propertyName: true, config: true },
        }),
      ])

      const globalFilters: GlobalFilterInput[] = filterRows.map((f) => {
        const cfg = (f.config && typeof f.config === 'object' ? f.config : {}) as {
          operator?: unknown
          value?: unknown
        }
        return {
          propertyName: f.propertyName,
          operator: asFilterOperator(cfg.operator),
          value: cfg.value,
        }
      })

      const results = await Promise.all(
        widgets.map(async (w) => {
          const parsed = widgetConfigSchema.safeParse(w.config)
          const config: WidgetConfig = parsed.success ? parsed.data : {}
          const result = await aggregateWidget(ctx.prisma, ctx.user.id, {
            sourceId: w.sourceId,
            viewId: w.viewId ?? undefined,
            type: w.type,
            config,
            globalFilters,
          })
          return { widgetId: w.id, result }
        }),
      )
      return { status: 'ok', widgets: results }
    }),
})

// ── Read loader ───────────────────────────────────────────────────────────────

async function loadDashboardRead(
  ctx: Ctx,
  dashboard: DashboardDto,
  editable: boolean,
): Promise<DashboardReadResult> {
  const [widgets, globalFilters] = await Promise.all([
    ctx.prisma.dashboardWidget.findMany({
      where: { dashboardId: dashboard.id },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        sourceId: true,
        viewId: true,
        type: true,
        title: true,
        config: true,
        gridX: true,
        gridY: true,
        gridW: true,
        gridH: true,
        position: true,
      },
    }),
    ctx.prisma.dashboardGlobalFilter.findMany({
      where: { dashboardId: dashboard.id },
      orderBy: { position: 'asc' },
      select: { id: true, propertyName: true, config: true, position: true },
    }),
  ])
  return {
    status: 'ok',
    dashboard,
    widgets: widgets.map(projectWidget),
    globalFilters: globalFilters.map(projectGlobalFilter),
    editable,
  }
}
