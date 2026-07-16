import * as domain from '@repo/domain'

import { domain as domainSvc } from '../../domain'
import { assertPageAccess, assertPageEditAccess } from '../../helpers/page-access'
import { mapDomain } from '../../helpers/map-domain'
import { protectedProcedure, router } from '../../trpc'

export const formManagementRouter = router({
  create: protectedProcedure.input(domain.createFormInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.create(ctx.user.id, input))
  }),

  get: protectedProcedure.input(domain.formIdInput).query(async ({ ctx, input }) => {
    await assertPageAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.get(ctx.user.id, input))
  }),

  list: protectedProcedure.input(domain.listFormsInput).query(async ({ ctx, input }) => {
    await assertPageAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.list(ctx.user.id, input))
  }),

  updateDraft: protectedProcedure
    .input(domain.updateFormDraftInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.databaseForms.updateDraft(ctx.user.id, input))
    }),

  publish: protectedProcedure.input(domain.publishFormInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.publish(ctx.user.id, input))
  }),

  updateSettings: protectedProcedure
    .input(domain.updateFormSettingsInput)
    .mutation(async ({ ctx, input }) => {
      await assertPageEditAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.databaseForms.updateSettings(ctx.user.id, input))
    }),

  setSlug: protectedProcedure.input(domain.setFormSlugInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.setSlug(ctx.user.id, input))
  }),

  rotateKey: protectedProcedure.input(domain.formIdInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.rotateKey(ctx.user.id, input))
  }),

  close: protectedProcedure.input(domain.formIdInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.close(ctx.user.id, input))
  }),

  reopen: protectedProcedure.input(domain.formIdInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.reopen(ctx.user.id, input))
  }),

  archive: protectedProcedure.input(domain.formIdInput).mutation(async ({ ctx, input }) => {
    await assertPageEditAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.archive(ctx.user.id, input))
  }),

  listVersions: protectedProcedure.input(domain.formIdInput).query(async ({ ctx, input }) => {
    await assertPageAccess(ctx, input.pageId)
    return mapDomain(() => domainSvc.databaseForms.listVersions(ctx.user.id, input))
  }),

  listResponses: protectedProcedure
    .input(domain.listFormResponsesInput)
    .query(async ({ ctx, input }) => {
      await assertPageAccess(ctx, input.pageId)
      return mapDomain(() => domainSvc.databaseForms.listResponses(ctx.user.id, input))
    }),
})
