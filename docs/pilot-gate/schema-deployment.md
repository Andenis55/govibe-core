# Schema Deployment And Rollback

## Current State

The repository now has a committed Prisma migration baseline in [prisma/migrations](../../prisma/migrations). Release-like bootstrap paths now expect `prisma migrate deploy` by default and no longer silently fall back to `db push` unless `ALLOW_PRISMA_DB_PUSH_BOOTSTRAP=true` is explicitly set for non-release scenarios.

That closes the migration-history gap. The remaining operational requirement is disciplined backup and restore rehearsal.

The repository now includes an executable rehearsal script:

```bash
npm run schema:rehearsal:plan
npm run schema:rehearsal:run
```

This script automates the database-side rehearsal flow: snapshot, `prisma migrate status`, `prisma migrate deploy`, health checks, optional payment smoke, restore to a rehearsal target, and artifact-manifest capture. It does not automate application redeploy with environment-specific rollout tooling, which remains an operator-owned platform step.

## Release Path

Use this path for any deployment that includes schema changes.

1. Confirm the target commit is green for `npm run build`, `npm test`, and `npm run test:bootstrap-smoke`.
2. Run `npm run prisma:migrate:status` on the release commit.
3. Take a pre-deploy database snapshot using the platform-native backup mechanism.
4. Record the snapshot identifier in the release ticket.
5. Run `npm run prisma:migrate:deploy`.
6. Run `npm run prisma:generate` if the deploy environment needs client generation at release time.
7. Start or roll the application.
8. Verify `/api/health/live`, `/api/health/ready`, and `/api/metrics`.
9. Execute the pilot functional checks from [deployment-checklist.md](./deployment-checklist.md).

## Scripted Rehearsal

Use the scripted rehearsal before pilot launch and after any material change to the deployment process.

Plan the run first:

```bash
npm run schema:rehearsal:plan
```

Run the rehearsal:

```bash
npm run schema:rehearsal:run
```

Expected inputs:

1. `DATABASE_URL` for the database being snapshotted and migrated.
2. `SCHEMA_REHEARSAL_RESTORE_DATABASE_URL` is optional for the built-in Postgres flow. If it is omitted, the script derives a sibling restore target by appending `_restore` to the source database name.
3. `SCHEMA_REHEARSAL_ADMIN_DATABASE_URL` is optional. When omitted, the built-in Postgres flow uses the same host and credentials as the restore target but connects to the `postgres` maintenance database in order to drop and recreate the restore target before `pg_restore`.
4. Optional platform-specific snapshot and restore commands through `SCHEMA_REHEARSAL_SNAPSHOT_COMMAND` and `SCHEMA_REHEARSAL_RESTORE_COMMAND`.
5. Optional `SCHEMA_REHEARSAL_SKIP_HTTP_CHECKS=true` for DB-only local rehearsal when the app is not already serving `/api/health/*` and `/api/metrics`.
6. Optional `SCHEMA_REHEARSAL_RUN_PAYMENT_SMOKE=true` if the environment is configured for payment smoke validation.

For the built-in Postgres flow, the script now prepares the restore target automatically with `psql`, then runs `pg_restore` into that reset database. Custom restore commands bypass that preparation step.

Artifacts are written under `artifacts/schema-rehearsal/<timestamp>/` and include:

1. the backup file path,
2. per-step command and health-check logs,
3. a JSON manifest describing the rehearsal inputs and outcomes.

## Rules

1. Do not use `prisma db push` in shared, staging, or production-like environments.
2. Do not apply schema changes without a recorded pre-deploy snapshot.
3. Do not merge schema changes without a corresponding migration in [prisma/migrations](../../prisma/migrations).
4. Do not treat `prisma migrate deploy` success as sufficient; application health and pilot smoke checks still decide the release.

## Rollback Decision Tree

1. If no schema migration was applied in the release, redeploy the previous application artifact.
2. If a schema migration was applied and the previous application version is still compatible with the new schema, redeploy the previous artifact only after verifying compatibility.
3. If a schema migration was applied and the previous application version is not compatible, restore the pre-deploy database snapshot and redeploy the previous artifact.

## Restore Procedure

This is the minimum pilot-safe restore path.

1. Stop or drain application traffic.
2. Restore the recorded pre-deploy database snapshot.
3. Redeploy the previous known-good application artifact using the environment rollout tooling.
4. Verify `/api/health/live` and `/api/health/ready`.
5. Run a controlled synthetic purchase and a controlled gate validation.
6. Confirm no unexpected backlog remains in `outbox_events`.

## Rehearsal Requirement

Pilot launch is still blocked until the team performs at least one end-to-end rehearsal of:

1. pre-deploy snapshot creation,
2. `prisma migrate deploy`,
3. application deployment,
4. snapshot restore,
5. previous-artifact redeploy,
6. post-restore smoke validation.

The scripted runbook covers items 1, 2, 4, and the artifact logging around 6. The application deploy and redeploy steps remain environment-specific and must be executed with the platform rollout tooling during the rehearsal.
