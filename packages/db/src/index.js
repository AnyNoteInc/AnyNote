"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxEventStatus = exports.FileStatus = exports.ChatMessageRole = exports.SubscriptionStatus = exports.IntegrationStatus = exports.IntegrationScope = exports.PageOwnership = exports.PageType = exports.RoleType = exports.Prisma = exports.PrismaClient = exports.prisma = void 0;
exports.enqueueOutboxEvent = enqueueOutboxEvent;
const client_1 = require("@prisma/client");
Object.defineProperty(exports, "PrismaClient", { enumerable: true, get: function () { return client_1.PrismaClient; } });
Object.defineProperty(exports, "Prisma", { enumerable: true, get: function () { return client_1.Prisma; } });
const adapter_pg_1 = require("@prisma/adapter-pg");
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ??
    (() => {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error("DATABASE_URL environment variable is not set.");
        }
        const adapter = new adapter_pg_1.PrismaPg({
            connectionString: databaseUrl,
        });
        return new client_1.PrismaClient({
            adapter,
            log: process.env.NODE_ENV === "production" ? ["error", "warn"] : ["query", "error", "warn"],
        });
    })();
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = exports.prisma;
}
var client_2 = require("@prisma/client");
Object.defineProperty(exports, "RoleType", { enumerable: true, get: function () { return client_2.RoleType; } });
Object.defineProperty(exports, "PageType", { enumerable: true, get: function () { return client_2.PageType; } });
Object.defineProperty(exports, "PageOwnership", { enumerable: true, get: function () { return client_2.PageOwnership; } });
Object.defineProperty(exports, "IntegrationScope", { enumerable: true, get: function () { return client_2.IntegrationScope; } });
Object.defineProperty(exports, "IntegrationStatus", { enumerable: true, get: function () { return client_2.IntegrationStatus; } });
Object.defineProperty(exports, "SubscriptionStatus", { enumerable: true, get: function () { return client_2.SubscriptionStatus; } });
Object.defineProperty(exports, "ChatMessageRole", { enumerable: true, get: function () { return client_2.ChatMessageRole; } });
Object.defineProperty(exports, "FileStatus", { enumerable: true, get: function () { return client_2.FileStatus; } });
var client_3 = require("@prisma/client");
Object.defineProperty(exports, "OutboxEventStatus", { enumerable: true, get: function () { return client_3.OutboxEventStatus; } });
async function enqueueOutboxEvent(tx, args) {
    await tx.outboxEvent.create({
        data: {
            eventType: args.eventType,
            aggregateType: args.aggregateType,
            aggregateId: args.aggregateId,
            workspaceId: args.workspaceId ?? null,
            payload: args.payload ?? {},
        },
    });
}
exports.default = exports.prisma;
//# sourceMappingURL=index.js.map