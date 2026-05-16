const { spawnSync } = require('node:child_process');
const path = require('node:path');

const jestPackageJson = require.resolve('jest/package.json');
const jestBin = path.join(path.dirname(jestPackageJson), 'bin', 'jest.js');
const result = spawnSync(
  process.execPath,
  [jestBin, '--runInBand', 'test/e2e/bootstrap/migration-bootstrap-smoke.spec.ts'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      RUN_BOOTSTRAP_SMOKE: '1',
    },
  },
);

process.exit(result.status ?? 1);