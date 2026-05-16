import {
  buildSchemaRehearsalConfig,
  createSchemaRehearsalContext,
  deriveRestoreDatabaseUrl,
  parseMode,
  resolvePrepareRestoreCommand,
  resolveRestoreCommand,
  resolveSnapshotCommand,
} from '../../../scripts/schema-rehearsal';

describe('schema rehearsal script helpers', () => {
  it('defaults to plan mode and parses rehearse explicitly', () => {
    expect(parseMode([])).toBe('plan');
    expect(parseMode(['rehearse'])).toBe('rehearse');
    expect(() => parseMode(['unknown'])).toThrow(
      'Unsupported schema rehearsal mode: unknown',
    );
  });

  it('derives health and metrics urls from API_BASE_URL', () => {
    const config = buildSchemaRehearsalConfig(
      {
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/govibe',
        API_BASE_URL: 'http://localhost:3000',
      },
      'C:/workspace/govibe-core',
    );

    expect(config.liveUrl).toBe('http://localhost:3000/api/health/live');
    expect(config.readyUrl).toBe('http://localhost:3000/api/health/ready');
    expect(config.metricsUrl).toBe('http://localhost:3000/api/metrics');
    expect(config.restoreDatabaseUrl).toBe(
      'postgresql://postgres:secret@localhost:5432/govibe_restore',
    );
    expect(config.restoreAdminDatabaseUrl).toBe(
      'postgresql://postgres:secret@localhost:5432/postgres',
    );
  });

  it('uses pg_dump by default and redacts credentials in the display command', () => {
    const config = buildSchemaRehearsalConfig(
      {
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/govibe',
      },
      'C:/workspace/govibe-core',
    );
    const context = createSchemaRehearsalContext(
      config,
      new Date('2026-04-15T12:30:45.000Z'),
    );
    const command = resolveSnapshotCommand(config, context);

    expect(command.kind).toBe('exec');
    if (command.kind === 'exec') {
      expect(command.command).toBe('pg_dump');
      expect(command.args).toEqual(
        expect.arrayContaining([
          '--format=custom',
          '--file',
          context.backupPath,
          'postgresql://postgres:secret@localhost:5432/govibe',
        ]),
      );
      expect(command.display).toContain('postgresql://postgres:***@localhost:5432/govibe');
    }
  });

  it('can derive a default restore database url with a custom suffix', () => {
    expect(
      deriveRestoreDatabaseUrl(
        'postgresql://postgres:secret@localhost:5432/govibe?sslmode=disable',
        '_shadow',
      ),
    ).toBe(
      'postgresql://postgres:secret@localhost:5432/govibe_shadow?sslmode=disable',
    );
  });

  it('uses custom command templates when provided', () => {
    const config = buildSchemaRehearsalConfig(
      {
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/govibe',
        SCHEMA_REHEARSAL_SNAPSHOT_COMMAND:
          'cloud-backup --source ${databaseUrl} --output ${backupPath}',
        SCHEMA_REHEARSAL_RESTORE_COMMAND:
          'cloud-restore --target ${restoreDatabaseUrl} --input ${backupPath}',
        SCHEMA_REHEARSAL_RESTORE_DATABASE_URL:
          'postgresql://postgres:restore@localhost:5432/govibe_restore',
      },
      'C:/workspace/govibe-core',
    );
    const context = createSchemaRehearsalContext(
      config,
      new Date('2026-04-15T12:30:45.000Z'),
    );
    const snapshot = resolveSnapshotCommand(config, context);
    const restore = resolveRestoreCommand(config, context);

    expect(snapshot.kind).toBe('shell');
    if (snapshot.kind === 'shell') {
      expect(snapshot.commandLine).toContain(context.backupPath);
      expect(snapshot.commandLine).toContain(
        'postgresql://postgres:secret@localhost:5432/govibe',
      );
      expect(snapshot.display).toContain(
        'postgresql://postgres:***@localhost:5432/govibe',
      );
    }

    expect(restore.kind).toBe('shell');
    if (restore.kind === 'shell') {
      expect(restore.commandLine).toContain(context.backupPath);
      expect(restore.commandLine).toContain(
        'postgresql://postgres:restore@localhost:5432/govibe_restore',
      );
      expect(restore.display).toContain(
        'postgresql://postgres:***@localhost:5432/govibe_restore',
      );
    }
  });

  it('prepares the restore database with psql before built-in restore', () => {
    const config = buildSchemaRehearsalConfig(
      {
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/govibe',
      },
      'C:/workspace/govibe-core',
    );
    const command = resolvePrepareRestoreCommand(config);

    expect(command.kind).toBe('exec');
    if (command.kind === 'exec') {
      expect(command.command).toBe('psql');
      expect(command.args).toEqual(
        expect.arrayContaining([
          '--dbname',
          'postgresql://postgres:secret@localhost:5432/postgres',
          '-v',
          'ON_ERROR_STOP=1',
        ]),
      );
      expect(command.display).toContain(
        'postgresql://postgres:***@localhost:5432/postgres',
      );
      expect(command.display).toContain('DROP DATABASE IF EXISTS "govibe_restore";');
      expect(command.display).toContain('CREATE DATABASE "govibe_restore";');
    }
  });

  it('skips derived health checks when configured for db-only local rehearsal', () => {
    const config = buildSchemaRehearsalConfig(
      {
        DATABASE_URL: 'postgresql://postgres:secret@localhost:5432/govibe',
        API_BASE_URL: 'http://localhost:3000',
        SCHEMA_REHEARSAL_SKIP_HTTP_CHECKS: 'true',
      },
      'C:/workspace/govibe-core',
    );

    expect(config.skipHttpChecks).toBe(true);
    expect(config.liveUrl).toBeUndefined();
    expect(config.readyUrl).toBeUndefined();
    expect(config.metricsUrl).toBeUndefined();
  });
});