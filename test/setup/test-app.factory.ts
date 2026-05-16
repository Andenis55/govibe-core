import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestingModuleBuilder } from '@nestjs/testing';
import { getTestGlobals } from './test-globals';

export async function createTestApp(
  builder: TestingModuleBuilder,
  options?: {
    registerGlobal?: boolean;
  },
): Promise<INestApplication> {
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.init();

  if (options?.registerGlobal) {
    getTestGlobals().__APP__ = app;
  }

  return app;
}

export async function closeRegisteredTestApp(): Promise<void> {
  const globals = getTestGlobals();

  if (!globals.__APP__) {
    return;
  }

  await globals.__APP__.close();
  globals.__APP__ = undefined;
}