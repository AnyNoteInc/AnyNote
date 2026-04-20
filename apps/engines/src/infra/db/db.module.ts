import { Global, Module } from "@nestjs/common"

import { prismaProvider } from "./db.providers.js"

@Global()
@Module({
  providers: [prismaProvider],
  exports: [prismaProvider],
})
export class DbModule {}
