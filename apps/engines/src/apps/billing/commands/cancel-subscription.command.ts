import { Command, CommandRunner } from 'nest-commander'
import { prisma } from '@repo/db'

@Command({
  name: 'cancel-subscription',
  description: 'Set cancelAtPeriodEnd=true on a subscription (admin)',
  arguments: '<subscriptionId>',
})
export class CancelSubscriptionCommand extends CommandRunner {
  async run(passedParams: string[]): Promise<void> {
    const [subscriptionId] = passedParams
    if (!subscriptionId) {
      console.error('Usage: cli cancel-subscription <subscriptionId>')
      process.exitCode = 1
      return
    }

    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { cancelAtPeriodEnd: true, cancelledAt: new Date() },
    })
    console.log('Subscription marked cancelAtPeriodEnd=true')
  }
}
