import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export async function startRedisContainer(): Promise<StartedTestContainer> {
  return new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
}

export async function startPostgresContainer(): Promise<StartedTestContainer> {
  return new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_DB: 'govibe_test',
      POSTGRES_USER: 'postgres',
      POSTGRES_PASSWORD: 'postgres',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections'),
    )
    .start();
}

export function buildPostgresUrl(container: StartedTestContainer): string {
  return `postgresql://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/govibe_test?schema=public`;
}

export function buildRedisUrl(container: StartedTestContainer): string {
  return `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
}

export async function startTestDependencies(): Promise<{
  postgres: StartedTestContainer;
  redis: StartedTestContainer;
  dispose: () => Promise<void>;
}> {
  const [postgres, redis] = await Promise.all([
    startPostgresContainer(),
    startRedisContainer(),
  ]);

  process.env.DATABASE_URL = buildPostgresUrl(postgres);
  process.env.REDIS_URL = buildRedisUrl(redis);

  return {
    postgres,
    redis,
    dispose: async () => {
      await Promise.allSettled([postgres.stop(), redis.stop()]);
    },
  };
}