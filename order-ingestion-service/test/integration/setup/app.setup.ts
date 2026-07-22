import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/config/app.setup';

export async function buildApp(): Promise<INestApplication<App>> {
  // Black-box tests: ephemeral store, no live pollers hitting :4000.
  process.env.DB_PATH = ':memory:';
  process.env.POLLING_ENABLED = 'false';
  delete process.env.WEBHOOK_SECRET;

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}
