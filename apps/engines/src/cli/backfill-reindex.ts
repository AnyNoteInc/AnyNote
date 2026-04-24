import "reflect-metadata"
import "dotenv/config"

import { prisma, Prisma } from "@repo/db"

async function main() {
  try {
    const pages = await prisma.page.findMany({
      where: { type: "TEXT", deletedAt: null },
      select: { id: true, workspaceId: true },
    })
    let inserted = 0
    for (const page of pages) {
      const rows = await prisma.$executeRaw(Prisma.sql`
        INSERT INTO outbox_events
          (event_type, aggregate_type, aggregate_id, workspace_id, payload, status, next_attempt_at)
        VALUES
          ('page.upserted', 'page', ${page.id}::uuid, ${page.workspaceId}::uuid, '{}'::jsonb,
           'PENDING', now())
        ON CONFLICT DO NOTHING
      `)
      if (rows > 0) inserted++
    }
    console.log(`Enqueued ${inserted}/${pages.length} pages for reindex`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
