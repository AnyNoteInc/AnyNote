import { prisma } from '@repo/db'
import { createDomain } from '@repo/domain'

export const domain = createDomain({ prisma })
