import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { buildApp } from './setup/app.setup';

interface Envelope<T> {
  message: string;
  data: T;
}
const env = <T>(body: unknown): Envelope<T> => body as Envelope<T>;

const freshmartPayload = {
  order_id: 'FM-100245',
  store_id: 'SP-014',
  store_name: 'FreshMart Pinheiros',
  placed_at: '2026-06-20T14:32:00Z',
  state: 'NEW',
  currency: 'BRL',
  lines: [
    { sku: '7891000', desc: 'Leite Integral 1L', qty: 6, price: 5.49 },
    { sku: '7890011', desc: 'Pão de Forma', qty: 2, price: 8.9 },
  ],
  ship_to: {
    street: 'Rua dos Pinheiros 123',
    city: 'São Paulo',
    country: 'BR',
  },
};

describe('Ingestion (integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a webhook push, normalizes it, and persists it', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/freshmart')
      .send(freshmartPayload)
      .expect(202);

    const created = env<{ outcome: string; orderId: string }>(res.body).data;
    expect(created.outcome).toBe('created');
    const orderId = created.orderId;

    const list = await request(app.getHttpServer()).get('/orders').expect(200);
    const orders = env<Array<Record<string, unknown>>>(list.body).data;
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      externalOrderId: 'FM-100245',
      customerId: 'freshmart',
      status: 'received',
      total: { amount: 50.74, currency: 'BRL' },
    });

    await request(app.getHttpServer()).get(`/orders/${orderId}`).expect(200);
  });

  it('is idempotent: the same push twice does not double-write', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/freshmart')
      .send(freshmartPayload)
      .expect(202);
    expect(env<{ outcome: string }>(res.body).data.outcome).toBe('unchanged');

    const stats = await request(app.getHttpServer())
      .get('/orders/stats')
      .expect(200);
    expect(env<{ orders: number }>(stats.body).data.orders).toBe(1);
  });

  it('rejects an unknown customer with 404', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/does-not-exist')
      .send(freshmartPayload)
      .expect(404);
  });

  it('rejects a webhook push to a pull customer with 400', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/bairrobox')
      .send({})
      .expect(400);
  });

  it('surfaces mapping failures at /orders/failures', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/freshmart')
      .send({ ...freshmartPayload, order_id: '', state: 'NEW' })
      .expect(202);

    const failures = await request(app.getHttpServer())
      .get('/orders/failures')
      .expect(200);
    const list = env<Array<Record<string, unknown>>>(failures.body).data;
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]).toHaveProperty('reason');
  });
});
