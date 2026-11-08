import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * One client per process (kept on globalThis so `tsx watch` reloads don't leak pools).
 * The pg pool connects lazily, so importing this module never needs a database.
 */
export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
