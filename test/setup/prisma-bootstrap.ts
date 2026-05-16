import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type PrismaBootstrapMode = 'migrate-deploy' | 'db-push';

export async function runPrismaBootstrap(
  cwd = process.cwd(),
): Promise<PrismaBootstrapMode> {
  const prismaCli = require.resolve('prisma/build/index.js');
  const hasMigrations = hasPrismaMigrations(cwd);
  const allowDbPushFallback = process.env.ALLOW_PRISMA_DB_PUSH_BOOTSTRAP === 'true';

  if (!hasMigrations && !allowDbPushFallback) {
    throw new Error(
      'Prisma migrations directory missing. Refusing db push bootstrap without ALLOW_PRISMA_DB_PUSH_BOOTSTRAP=true.',
    );
  }

  const mode = hasMigrations ? 'migrate-deploy' : 'db-push';
  const args =
    mode === 'migrate-deploy'
      ? ['migrate', 'deploy']
      : ['db', 'push', '--skip-generate'];

  let lastError: unknown;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      execFileSync(process.execPath, [prismaCli, ...args], {
        cwd,
        env: process.env,
        stdio: 'pipe',
      });

      return mode;
    } catch (error) {
      lastError = error;

      if (!isTransientBootstrapError(error) || attempt === 14) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError;
}

function hasPrismaMigrations(cwd: string): boolean {
  const migrationsPath = join(cwd, 'prisma', 'migrations');

  if (!existsSync(migrationsPath)) {
    return false;
  }

  return readdirSync(migrationsPath).length > 0;
}

function isTransientBootstrapError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return message.includes('P1001') || message.includes("Can't reach database server");
}