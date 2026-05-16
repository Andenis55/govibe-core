import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type EnvMap = NodeJS.ProcessEnv;

export type SchemaRehearsalMode = 'plan' | 'rehearse';

export type SchemaRehearsalConfig = {
  cwd: string;
  databaseUrl: string;
  restoreDatabaseUrl?: string;
  restoreAdminDatabaseUrl?: string;
  artifactRootDir: string;
  runPaymentSmoke: boolean;
  skipHttpChecks: boolean;
  liveUrl?: string;
  readyUrl?: string;
  metricsUrl?: string;
  snapshotCommandTemplate?: string;
  restoreCommandTemplate?: string;
};

export type SchemaRehearsalContext = {
  rehearsalId: string;
  artifactDir: string;
  backupPath: string;
  manifestPath: string;
  logsDir: string;
};

type CommandSpec =
  | {
      kind: 'exec';
      command: string;
      args: string[];
      display: string;
      env?: EnvMap;
    }
  | {
      kind: 'shell';
      commandLine: string;
      display: string;
      env?: EnvMap;
    };

type StepStatus = 'passed' | 'failed' | 'skipped';

type StepResult = {
  name: string;
  status: StepStatus;
  logFile: string;
};

type Manifest = {
  rehearsalId: string;
  startedAt: string;
  completedAt?: string;
  artifactDir: string;
  backupPath: string;
  databaseUrl: string;
  restoreDatabaseUrl?: string;
  restoreAdminDatabaseUrl?: string;
  runPaymentSmoke: boolean;
  skipHttpChecks: boolean;
  liveUrl?: string;
  readyUrl?: string;
  metricsUrl?: string;
  steps: StepResult[];
  manualFollowUps: string[];
};

const DEFAULT_ARTIFACT_ROOT = 'artifacts/schema-rehearsal';
const DEFAULT_SNAPSHOT_FILE = 'pre-deploy.dump';
const DEFAULT_HTTP_TIMEOUT_MS = 10000;
const DEFAULT_RESTORE_DATABASE_SUFFIX = '_restore';
const DEFAULT_ADMIN_DATABASE = 'postgres';

function loadLocalEnvFiles(): void {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = resolve(process.cwd(), fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    const contents = readFileSync(filePath, 'utf8');

    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim();

      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');

      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (!(key in process.env)) {
        process.env[key] = stripWrappingQuotes(value);
      }
    }
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function getRequiredEnv(key: string, env: EnvMap = process.env): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getOptionalEnv(key: string, env: EnvMap = process.env): string | undefined {
  return env[key]?.trim() || undefined;
}

export function parseMode(argv: readonly string[]): SchemaRehearsalMode {
  const requested = argv[0]?.trim().toLowerCase();

  if (!requested || requested === 'plan') {
    return 'plan';
  }

  if (requested === 'rehearse') {
    return 'rehearse';
  }

  throw new Error(`Unsupported schema rehearsal mode: ${requested}`);
}

export function buildSchemaRehearsalConfig(
  env: EnvMap = process.env,
  cwd = process.cwd(),
): SchemaRehearsalConfig {
  const databaseUrl = getRequiredEnv('DATABASE_URL', env);
  const restoreCommandTemplate = getOptionalEnv(
    'SCHEMA_REHEARSAL_RESTORE_COMMAND',
    env,
  );
  const restoreDatabaseUrl =
    getOptionalEnv('SCHEMA_REHEARSAL_RESTORE_DATABASE_URL', env) ??
    (!restoreCommandTemplate
      ? deriveRestoreDatabaseUrl(
          databaseUrl,
          getOptionalEnv('SCHEMA_REHEARSAL_RESTORE_DATABASE_SUFFIX', env) ??
            DEFAULT_RESTORE_DATABASE_SUFFIX,
        )
      : undefined);
  const skipHttpChecks =
    getOptionalEnv('SCHEMA_REHEARSAL_SKIP_HTTP_CHECKS', env) === 'true';
  const artifactRootDir = resolve(
    cwd,
    getOptionalEnv('SCHEMA_REHEARSAL_ARTIFACT_DIR', env) ?? DEFAULT_ARTIFACT_ROOT,
  );
  const apiBaseUrl = getOptionalEnv('API_BASE_URL', env);

  return {
    cwd,
    databaseUrl,
    restoreDatabaseUrl,
    restoreAdminDatabaseUrl:
      !restoreCommandTemplate && restoreDatabaseUrl
        ? getOptionalEnv('SCHEMA_REHEARSAL_ADMIN_DATABASE_URL', env) ??
          deriveAdminDatabaseUrl(restoreDatabaseUrl)
        : undefined,
    artifactRootDir,
    runPaymentSmoke:
      getOptionalEnv('SCHEMA_REHEARSAL_RUN_PAYMENT_SMOKE', env) === 'true',
    skipHttpChecks,
    liveUrl:
      skipHttpChecks
        ? undefined
        : getOptionalEnv('SCHEMA_REHEARSAL_LIVE_URL', env) ??
          deriveUrl(apiBaseUrl, '/api/health/live'),
    readyUrl:
      skipHttpChecks
        ? undefined
        : getOptionalEnv('SCHEMA_REHEARSAL_READY_URL', env) ??
          deriveUrl(apiBaseUrl, '/api/health/ready'),
    metricsUrl:
      skipHttpChecks
        ? undefined
        : getOptionalEnv('SCHEMA_REHEARSAL_METRICS_URL', env) ??
          deriveUrl(apiBaseUrl, '/api/metrics'),
    snapshotCommandTemplate: getOptionalEnv('SCHEMA_REHEARSAL_SNAPSHOT_COMMAND', env),
    restoreCommandTemplate,
  };
}

export function createSchemaRehearsalContext(
  config: SchemaRehearsalConfig,
  now = new Date(),
): SchemaRehearsalContext {
  const rehearsalId = now.toISOString().replace(/[:.]/g, '-');
  const artifactDir = join(config.artifactRootDir, rehearsalId);
  const logsDir = join(artifactDir, 'logs');

  return {
    rehearsalId,
    artifactDir,
    logsDir,
    backupPath: join(artifactDir, DEFAULT_SNAPSHOT_FILE),
    manifestPath: join(artifactDir, 'manifest.json'),
  };
}

export function resolveSnapshotCommand(
  config: SchemaRehearsalConfig,
  context: SchemaRehearsalContext,
): CommandSpec {
  if (config.snapshotCommandTemplate) {
    const commandLine = applyTemplate(config.snapshotCommandTemplate, {
      rehearsalId: context.rehearsalId,
      artifactDir: context.artifactDir,
      backupPath: context.backupPath,
      databaseUrl: config.databaseUrl,
      restoreDatabaseUrl: config.restoreDatabaseUrl ?? '',
    });

    const display = applyTemplate(config.snapshotCommandTemplate, {
      rehearsalId: context.rehearsalId,
      artifactDir: context.artifactDir,
      backupPath: context.backupPath,
      databaseUrl: redactDatabaseUrl(config.databaseUrl),
      restoreDatabaseUrl: redactDatabaseUrl(config.restoreDatabaseUrl),
    });

    return {
      kind: 'shell',
      commandLine,
      display,
    };
  }

  return {
    kind: 'exec',
    command: 'pg_dump',
    args: ['--format=custom', '--file', context.backupPath, config.databaseUrl],
    display: `pg_dump --format=custom --file ${context.backupPath} ${redactDatabaseUrl(config.databaseUrl)}`,
  };
}

export function resolveRestoreCommand(
  config: SchemaRehearsalConfig,
  context: SchemaRehearsalContext,
): CommandSpec {
  if (config.restoreCommandTemplate) {
    const commandLine = applyTemplate(config.restoreCommandTemplate, {
      rehearsalId: context.rehearsalId,
      artifactDir: context.artifactDir,
      backupPath: context.backupPath,
      databaseUrl: config.databaseUrl,
      restoreDatabaseUrl: config.restoreDatabaseUrl ?? '',
    });

    const display = applyTemplate(config.restoreCommandTemplate, {
      rehearsalId: context.rehearsalId,
      artifactDir: context.artifactDir,
      backupPath: context.backupPath,
      databaseUrl: redactDatabaseUrl(config.databaseUrl),
      restoreDatabaseUrl: redactDatabaseUrl(config.restoreDatabaseUrl),
    });

    return {
      kind: 'shell',
      commandLine,
      display,
    };
  }

  if (!config.restoreDatabaseUrl) {
    throw new Error(
      'SCHEMA_REHEARSAL_RESTORE_DATABASE_URL is required unless SCHEMA_REHEARSAL_RESTORE_COMMAND is set.',
    );
  }

  return {
    kind: 'exec',
    command: 'pg_restore',
    args: [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      `--dbname=${config.restoreDatabaseUrl}`,
      context.backupPath,
    ],
    display:
      `pg_restore --clean --if-exists --no-owner --no-privileges ` +
      `--dbname=${redactDatabaseUrl(config.restoreDatabaseUrl)} ${context.backupPath}`,
  };
}

export function resolvePrepareRestoreCommand(
  config: SchemaRehearsalConfig,
): CommandSpec {
  if (config.restoreCommandTemplate || !config.restoreDatabaseUrl) {
    throw new Error(
      'Built-in restore database preparation requires SCHEMA_REHEARSAL_RESTORE_DATABASE_URL and no custom restore command.',
    );
  }

  const adminDatabaseUrl =
    config.restoreAdminDatabaseUrl ?? deriveAdminDatabaseUrl(config.restoreDatabaseUrl);

  if (targetsSameDatabase(adminDatabaseUrl, config.restoreDatabaseUrl)) {
    throw new Error(
      'SCHEMA_REHEARSAL_ADMIN_DATABASE_URL must point to a maintenance database, not the restore target.',
    );
  }

  const restoreDatabaseName = getDatabaseName(
    config.restoreDatabaseUrl,
    'SCHEMA_REHEARSAL_RESTORE_DATABASE_URL',
  );
  const terminateConnectionsSql =
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity ` +
    `WHERE datname = ${quotePostgresStringLiteral(restoreDatabaseName)} AND pid <> pg_backend_pid();`;
  const dropDatabaseSql =
    `DROP DATABASE IF EXISTS ${quotePostgresIdentifier(restoreDatabaseName)};`;
  const createDatabaseSql =
    `CREATE DATABASE ${quotePostgresIdentifier(restoreDatabaseName)};`;

  return {
    kind: 'exec',
    command: 'psql',
    args: [
      '--dbname',
      adminDatabaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      terminateConnectionsSql,
      '-c',
      dropDatabaseSql,
      '-c',
      createDatabaseSql,
    ],
    display:
      `psql --dbname ${redactDatabaseUrl(adminDatabaseUrl)} ` +
      `-v ON_ERROR_STOP=1 -c ${terminateConnectionsSql} ` +
      `-c ${dropDatabaseSql} -c ${createDatabaseSql}`,
  };
}

function resolvePrismaCommand(args: string[], databaseUrl?: string): CommandSpec {
  const prismaCli = require.resolve('prisma/build/index.js');

  return {
    kind: 'exec',
    command: process.execPath,
    args: [prismaCli, ...args],
    display: `node ${prismaCli} ${args.join(' ')}`,
    env: databaseUrl
      ? {
          ...process.env,
          DATABASE_URL: databaseUrl,
        }
      : undefined,
  };
}

function resolvePaymentSmokeCommand(): CommandSpec {
  return {
    kind: 'exec',
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['run', 'payments:smoke'],
    display: 'npm run payments:smoke',
  };
}

function deriveUrl(baseUrl: string | undefined, path: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  return new URL(path, baseUrl).toString();
}

export function deriveRestoreDatabaseUrl(
  databaseUrl: string,
  suffix = DEFAULT_RESTORE_DATABASE_SUFFIX,
): string {
  const url = parseDatabaseUrl(databaseUrl, 'DATABASE_URL');
  const databaseName = getDatabaseName(url, 'DATABASE_URL');
  const restoreUrl = new URL(url.toString());
  restoreUrl.pathname = `/${encodeURIComponent(`${databaseName}${suffix}`)}`;

  return restoreUrl.toString();
}

export function deriveAdminDatabaseUrl(databaseUrl: string): string {
  const url = parseDatabaseUrl(databaseUrl, 'restore database URL');
  const adminUrl = new URL(url.toString());
  adminUrl.pathname = `/${DEFAULT_ADMIN_DATABASE}`;

  return adminUrl.toString();
}

function applyTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\$\{(\w+)\}/g, (_match, key: string) => values[key] ?? '');
}

function redactDatabaseUrl(value: string | undefined): string {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);

    if (url.password) {
      url.password = '***';
    }

    return url.toString();
  } catch {
    return value;
  }
}

function parseDatabaseUrl(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function getDatabaseName(value: string | URL, label: string): string {
  const url = value instanceof URL ? value : parseDatabaseUrl(value, label);
  const pathname = url.pathname.replace(/^\/+/, '');

  if (!pathname) {
    throw new Error(`${label} must include a database name.`);
  }

  const databaseName = decodeURIComponent(pathname);

  if (databaseName.includes('/')) {
    throw new Error(`${label} must include a single database name.`);
  }

  return databaseName;
}

function quotePostgresIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quotePostgresStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizePostgresPort(url: URL): string {
  return url.port || '5432';
}

function targetsSameDatabase(left: string, right: string): boolean {
  const leftUrl = parseDatabaseUrl(left, 'database URL');
  const rightUrl = parseDatabaseUrl(right, 'database URL');

  return (
    leftUrl.hostname === rightUrl.hostname &&
    normalizePostgresPort(leftUrl) === normalizePostgresPort(rightUrl) &&
    getDatabaseName(leftUrl, 'database URL') ===
      getDatabaseName(rightUrl, 'database URL')
  );
}

function usesBuiltInRestore(config: SchemaRehearsalConfig): boolean {
  return !config.restoreCommandTemplate;
}

function ensureCommandAvailable(command: string): void {
  const result =
    process.platform === 'win32'
      ? spawnSync('where', [command], { stdio: 'pipe', encoding: 'utf8' })
      : spawnSync('sh', ['-lc', `command -v ${command}`], {
          stdio: 'pipe',
          encoding: 'utf8',
        });

  if (result.status !== 0) {
    throw new Error(
      `Required command not found on PATH: ${command}. Configure a custom schema rehearsal command if your environment uses platform-specific backup tooling.`,
    );
  }
}

function assertRehearsalPreconditions(config: SchemaRehearsalConfig): void {
  if (!config.snapshotCommandTemplate) {
    ensureCommandAvailable('pg_dump');
  }

  if (config.restoreDatabaseUrl && targetsSameDatabase(config.databaseUrl, config.restoreDatabaseUrl)) {
    throw new Error(
      'SCHEMA_REHEARSAL_RESTORE_DATABASE_URL must point to a different database than DATABASE_URL.',
    );
  }

  if (usesBuiltInRestore(config)) {
    ensureCommandAvailable('pg_restore');
    ensureCommandAvailable('psql');
    resolvePrepareRestoreCommand(config);
  }

  if (!config.skipHttpChecks) {
    if (config.liveUrl) {
      new URL(config.liveUrl);
    }

    if (config.readyUrl) {
      new URL(config.readyUrl);
    }

    if (config.metricsUrl) {
      new URL(config.metricsUrl);
    }
  }
}

function executeCommand(
  spec: CommandSpec,
  cwd: string,
  logFile: string,
): void {
  const result =
    spec.kind === 'exec'
      ? spawnSync(spec.command, spec.args, {
          cwd,
          env: spec.env ?? process.env,
          encoding: 'utf8',
        })
      : spawnSync(
          process.platform === 'win32' ? 'cmd.exe' : 'sh',
          process.platform === 'win32'
            ? ['/d', '/s', '/c', spec.commandLine]
            : ['-lc', spec.commandLine],
          {
            cwd,
            env: spec.env ?? process.env,
            encoding: 'utf8',
          },
        );

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const rendered = [`$ ${spec.display}`, stdout, stderr].filter(Boolean).join('\n');
  writeFileSync(logFile, rendered, 'utf8');

  if (result.status !== 0) {
    throw new Error(`Command failed: ${spec.display}. See ${logFile}.`);
  }
}

async function executeHttpCheck(
  name: string,
  url: string,
  logFile: string,
): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DEFAULT_HTTP_TIMEOUT_MS),
  });
  const body = await response.text();
  writeFileSync(
    logFile,
    [`GET ${url}`, `status=${response.status}`, body].join('\n'),
    'utf8',
  );

  if (!response.ok) {
    throw new Error(`Health check failed for ${name}: ${response.status}. See ${logFile}.`);
  }
}

async function runStep(
  manifest: Manifest,
  name: string,
  action: (logFile: string) => Promise<void> | void,
  logsDir: string,
): Promise<void> {
  const logFile = join(logsDir, `${name}.log`);

  try {
    await action(logFile);
    manifest.steps.push({
      name,
      status: 'passed',
      logFile,
    });
  } catch (error) {
    manifest.steps.push({
      name,
      status: 'failed',
      logFile,
    });
    throw error;
  }
}

async function runRehearsal(config: SchemaRehearsalConfig): Promise<void> {
  assertRehearsalPreconditions(config);

  const context = createSchemaRehearsalContext(config);
  mkdirSync(context.logsDir, { recursive: true });

  const manifest: Manifest = {
    rehearsalId: context.rehearsalId,
    startedAt: new Date().toISOString(),
    artifactDir: context.artifactDir,
    backupPath: context.backupPath,
    databaseUrl: redactDatabaseUrl(config.databaseUrl),
    restoreDatabaseUrl: redactDatabaseUrl(config.restoreDatabaseUrl),
    restoreAdminDatabaseUrl: redactDatabaseUrl(config.restoreAdminDatabaseUrl),
    runPaymentSmoke: config.runPaymentSmoke,
    skipHttpChecks: config.skipHttpChecks,
    liveUrl: config.liveUrl,
    readyUrl: config.readyUrl,
    metricsUrl: config.metricsUrl,
    steps: [],
    manualFollowUps: [
      'Redeploy the previous application artifact using the environment deployment tooling after validating the restore target.',
      'Re-run application health checks and pilot smoke checks against the previous artifact deployment before clearing the rehearsal.',
    ],
  };

  writeFileSync(context.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  try {
    await runStep(
      manifest,
      'snapshot',
      (logFile) =>
        executeCommand(resolveSnapshotCommand(config, context), config.cwd, logFile),
      context.logsDir,
    );
    await runStep(
      manifest,
      'prisma-migrate-status',
      (logFile) =>
        executeCommand(resolvePrismaCommand(['migrate', 'status']), config.cwd, logFile),
      context.logsDir,
    );
    await runStep(
      manifest,
      'prisma-migrate-deploy',
      (logFile) =>
        executeCommand(resolvePrismaCommand(['migrate', 'deploy']), config.cwd, logFile),
      context.logsDir,
    );

    if (usesBuiltInRestore(config)) {
      await runStep(
        manifest,
        'prepare-restore-database',
        (logFile) =>
          executeCommand(resolvePrepareRestoreCommand(config), config.cwd, logFile),
        context.logsDir,
      );
    }

    if (config.liveUrl) {
      await runStep(
        manifest,
        'health-live',
        (logFile) => executeHttpCheck('live', config.liveUrl!, logFile),
        context.logsDir,
      );
    }

    if (config.readyUrl) {
      await runStep(
        manifest,
        'health-ready',
        (logFile) => executeHttpCheck('ready', config.readyUrl!, logFile),
        context.logsDir,
      );
    }

    if (config.metricsUrl) {
      await runStep(
        manifest,
        'metrics',
        (logFile) => executeHttpCheck('metrics', config.metricsUrl!, logFile),
        context.logsDir,
      );
    }

    if (config.runPaymentSmoke) {
      await runStep(
        manifest,
        'payment-smoke',
        (logFile) =>
          executeCommand(resolvePaymentSmokeCommand(), config.cwd, logFile),
        context.logsDir,
      );
    }

    await runStep(
      manifest,
      'restore',
      (logFile) =>
        executeCommand(resolveRestoreCommand(config, context), config.cwd, logFile),
      context.logsDir,
    );

    if (config.restoreDatabaseUrl) {
      await runStep(
        manifest,
        'restore-prisma-status',
        (logFile) =>
          executeCommand(
            resolvePrismaCommand(['migrate', 'status'], config.restoreDatabaseUrl),
            config.cwd,
            logFile,
          ),
        context.logsDir,
      );
    } else {
      manifest.steps.push({
        name: 'restore-prisma-status',
        status: 'skipped',
        logFile: join(context.logsDir, 'restore-prisma-status.log'),
      });
      writeFileSync(
        join(context.logsDir, 'restore-prisma-status.log'),
        'Skipped built-in restore verification because no restore database URL was configured.',
        'utf8',
      );
    }

    manifest.completedAt = new Date().toISOString();
    writeFileSync(context.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    console.log(`Schema rehearsal completed. Artifacts: ${context.artifactDir}`);
  } catch (error) {
    manifest.completedAt = new Date().toISOString();
    writeFileSync(context.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    throw error;
  }
}

function printPlan(config: SchemaRehearsalConfig): void {
  const context = createSchemaRehearsalContext(config);
  const restoreStep = describeRestoreStep(config, context);
  const lines = [
    `Schema rehearsal plan`,
    `rehearsal_id: ${context.rehearsalId}`,
    `artifact_dir: ${context.artifactDir}`,
    `backup_path: ${context.backupPath}`,
    `database_url: ${redactDatabaseUrl(config.databaseUrl)}`,
    `restore_database_url: ${redactDatabaseUrl(config.restoreDatabaseUrl) || 'not configured'}`,
    `restore_admin_database_url: ${redactDatabaseUrl(config.restoreAdminDatabaseUrl) || 'not configured'}`,
    `run_payment_smoke: ${config.runPaymentSmoke}`,
    `skip_http_checks: ${config.skipHttpChecks}`,
    `live_url: ${config.liveUrl ?? 'not configured'}`,
    `ready_url: ${config.readyUrl ?? 'not configured'}`,
    `metrics_url: ${config.metricsUrl ?? 'not configured'}`,
    `snapshot_step: ${resolveSnapshotCommand(config, context).display}`,
    `prepare_restore_step: ${describePrepareRestoreStep(config)}`,
    `restore_step: ${restoreStep}`,
    `manual_follow_up: redeploy the previous application artifact with platform tooling after restore verification`,
  ];

  console.log(lines.join('\n'));
}

function describeRestoreStep(
  config: SchemaRehearsalConfig,
  context: SchemaRehearsalContext,
): string {
  try {
    return resolveRestoreCommand(config, context).display;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const mode = parseMode(process.argv.slice(2));
  const config = buildSchemaRehearsalConfig();

  if (mode === 'plan') {
    printPlan(config);
    return;
  }

  await runRehearsal(config);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Schema rehearsal failed: ${message}`);
    process.exitCode = 1;
  });
}

function describePrepareRestoreStep(config: SchemaRehearsalConfig): string {
  if (!usesBuiltInRestore(config)) {
    return 'skipped because a custom restore command is configured';
  }

  try {
    return resolvePrepareRestoreCommand(config).display;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}