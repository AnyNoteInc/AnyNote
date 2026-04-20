import { Test } from "@nestjs/testing"

import { DbModule } from "./db.module.js"
import { PRISMA } from "./db.providers.js"

describe("DbModule", () => {
  it("exposes PRISMA provider", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
    }).compile()
    const prisma = moduleRef.get(PRISMA)
    expect(prisma).toBeDefined()
    expect(typeof prisma.$connect).toBe("function")
  })
})
