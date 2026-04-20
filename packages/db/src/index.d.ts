import { PrismaClient, Prisma } from "@prisma/client";
export declare const prisma: PrismaClient<Prisma.PrismaClientOptions, never, import("@prisma/client/runtime/client").DefaultArgs>;
export { PrismaClient, Prisma };
export { RoleType, PageType, PageOwnership, IntegrationScope, IntegrationStatus, SubscriptionStatus, ChatMessageRole, FileStatus, } from "@prisma/client";
export type { User, Account, Session, Verification, Jwks, Workspace, WorkspaceMember, Page, UserPreference, IntegrationProvider, Integration, Plan, Subscription, Chat, ChatMessage, ChatMessageFile, AiProvider, AiModel, WorkspaceAiSettings, FavoritePage, File, PageFile, OutboxEvent, } from "@prisma/client";
export { OutboxEventStatus } from "@prisma/client";
export type OutboxAggregateType = "page" | "file";
export interface EnqueueOutboxEventArgs {
    eventType: string;
    aggregateType: OutboxAggregateType;
    aggregateId: string;
    workspaceId?: string | null;
    payload?: Prisma.InputJsonValue;
}
export declare function enqueueOutboxEvent(tx: Prisma.TransactionClient, args: EnqueueOutboxEventArgs): Promise<void>;
export default prisma;
