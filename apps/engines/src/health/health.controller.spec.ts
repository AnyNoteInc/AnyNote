import { Test, TestingModule } from '@nestjs/testing'

import { HealthController } from './health.controller.js'

describe('HealthController', () => {
  let controller: HealthController

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile()
    controller = moduleRef.get(HealthController)
  })

  it('returns ok status', () => {
    expect(controller.health()).toEqual({ status: 'ok' })
  })
})
