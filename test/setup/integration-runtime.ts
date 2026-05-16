import { execFileSync } from 'node:child_process';
import Redis from 'ioredis';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { applyTestEnv } from './env.setup';
import { runPrismaBootstrap } from './prisma-bootstrap';
import { resetPersistence } from './reset-persistence';
import { startTestDependencies } from './testcontainers';
import { getTestGlobals } from './test-globals';

export class ContainerRuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContainerRuntimeUnavailableError';
  }
}

export type IntegrationRuntime = {
  prisma: PrismaService;
  redisClient: Redis;
  redisService: RedisService;
  reset: () => Promise<void>;
  dispose: () => Promise<void>;
};

export async function createIntegrationRuntime(): Promise<IntegrationRuntime> {
  applyTestEnv();

  let dependencies;

  try {
    dependencies = await startTestDependencies();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Could not find a working container runtime strategy')
    ) {
      throw new ContainerRuntimeUnavailableError(
        'Container runtime unavailable for Testcontainers-backed specs.',
      );
    }

    throw error;
  }

  await runPrismaBootstrap();

  const prisma = new PrismaService();
  await prisma.connect();

  const redisClient = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: false,
  });
  const redisService = new RedisService(redisClient);

  await redisClient.ping();

  const globals = getTestGlobals();
  globals.__PRISMA__ = prisma;
  globals.__REDIS_CLIENT__ = redisClient;

  return {
    prisma,
    redisClient,
    redisService,
    reset: async () => resetPersistence(prisma, redisClient),
    dispose: async () => {
      const currentGlobals = getTestGlobals();

      if (currentGlobals.__PRISMA__ === prisma) {
        currentGlobals.__PRISMA__ = undefined;
      }

      if (currentGlobals.__REDIS_CLIENT__ === redisClient) {
        currentGlobals.__REDIS_CLIENT__ = undefined;
      }

      await Promise.allSettled([
        prisma.disconnect(),
        redisClient.quit(),
        dependencies.dispose(),
      ]);
    },
  };
}

