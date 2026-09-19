import { PrismaClient } from '@prisma/client';

import { isProduction } from '../env';

/**
 * Serverless-safe singleton. Vercel reuses module scope across warm
 * invocations, so caching the client on `globalThis` avoids opening a new
 * connection pool per request.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProduction ? ['error'] : ['warn', 'error'],
  });

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
