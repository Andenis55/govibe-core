import request = require('supertest');
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
} from '../../setup/operational-runtime';
import {
  PrismaBootstrapMode,
  runPrismaBootstrap,
} from '../../setup/prisma-bootstrap';

const describeBootstrapSmoke =
  process.env.RUN_BOOTSTRAP_SMOKE === '1' ? describe : describe.skip;

describeBootstrapSmoke('migration/bootstrap smoke test', () => {
  let runtime: OperationalRuntime | null = null;

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  it('applies Prisma bootstrap, boots the app, and responds ready', async () => {
    let bootstrapMode: PrismaBootstrapMode | null = null;

    try {
      runtime = await createOperationalRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }

    bootstrapMode = await runPrismaBootstrap();

    await request(runtime.app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect((response) => {
        expect(response.body.status).toBe('ready');
      });

    expect(bootstrapMode).toBe('migrate-deploy');
  });
});