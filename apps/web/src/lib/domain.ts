import 'server-only'

import { prisma } from '@repo/db'
import { createDomain } from '@repo/domain'

// Process-wide singleton: prisma is itself a singleton; actor ids are passed per call.
export const domain = createDomain({ prisma })
