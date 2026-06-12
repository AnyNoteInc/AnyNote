import { router, publicProcedure, createCallerFactory } from './trpc'
import { authRouter } from './routers/auth'
import { userRouter } from './routers/user'
import { workspaceRouter } from './routers/workspace'
import { subscriptionRouter } from './routers/subscription'
import { integrationRouter } from './routers/integration'
import { pageRouter } from './routers/page'
import { collectionRouter } from './routers/collection'
import { templateRouter } from './routers/template'
import { chatRouter } from './routers/chat'
import { consentRouter } from './routers/consent'
import { fileRouter } from './routers/file'
import { aiSettingsRouter } from './routers/ai-settings'
import { searchRouter } from './routers/search'
import { notificationRouter } from './routers/notification'
import { reminderRouter } from './routers/reminder'
import { kanbanRouter } from './routers/kanban'
import { databaseRouter } from './routers/database'
import { commentRouter } from './routers/comment'
import { mcpServerRouter } from './routers/mcp-server'
import { agentMemoryRouter } from './routers/agent-memory'
import { apiKeyRouter } from './routers/api-key'
import { aiProviderRouter } from './routers/ai-provider'
import { jobRouter } from './routers/job'
import { webhookRouter } from './routers/webhook'
import { telegramRouter } from './routers/telegram'
import { peopleRouter } from './routers/people'
import { identityRouter } from './routers/identity'
import { securityRouter } from './routers/security'
import { billingRouter } from './routers/billing'

export { createContext, createServerContext } from './trpc'
export type { Context, JobRunnerPort } from './trpc'

export type { PlanFeatures } from './helpers/plan'
export {
  getWorkspaceFeatures,
  getAvailableAiModels,
  getAvailableEmbeddingModels,
  requireWritableWorkspace,
  getActivePlanForUser,
} from './helpers/plan'
export { resolveActiveWorkspace } from './helpers/active-workspace'

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true })),
  auth: authRouter,
  user: userRouter,
  workspace: workspaceRouter,
  subscription: subscriptionRouter,
  integration: integrationRouter,
  page: pageRouter,
  collection: collectionRouter,
  template: templateRouter,
  search: searchRouter,
  chat: chatRouter,
  consent: consentRouter,
  file: fileRouter,
  aiSettings: aiSettingsRouter,
  notification: notificationRouter,
  reminder: reminderRouter,
  kanban: kanbanRouter,
  database: databaseRouter,
  comment: commentRouter,
  mcpServer: mcpServerRouter,
  agentMemory: agentMemoryRouter,
  apiKey: apiKeyRouter,
  aiProvider: aiProviderRouter,
  job: jobRouter,
  webhook: webhookRouter,
  telegram: telegramRouter,
  people: peopleRouter,
  identity: identityRouter,
  security: securityRouter,
  billing: billingRouter,
})

export const createCaller = createCallerFactory(appRouter)
export type AppRouter = typeof appRouter

export { getCurrentConsents, hasAllRequiredConsents, type CurrentConsent } from './lib/consents'
export { setDocumentVersionResolver } from './lib/document-versions'
