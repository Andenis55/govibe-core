import Redis from 'ioredis';
import { PrismaService } from '../../src/shared/prisma/prisma.service';

export async function resetPersistence(
  prisma: PrismaService,
  redisClient?: Redis,
): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );

  if (tables.length > 0) {
    const names = tables.map((table) => `\"${table.tablename}\"`).join(', ');

    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`,
    );
  }

  if (redisClient) {
    await redisClient.flushall();
  }
}