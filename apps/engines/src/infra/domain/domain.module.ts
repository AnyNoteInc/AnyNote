import { Global, Module } from '@nestjs/common'
import { domainProvider } from './domain.providers.js'

@Global()
@Module({
  providers: [domainProvider],
  exports: [domainProvider],
})
export class DomainModule {}
