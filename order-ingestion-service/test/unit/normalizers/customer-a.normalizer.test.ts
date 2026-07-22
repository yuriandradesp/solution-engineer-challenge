import { describe, expect, it } from 'vitest';
import { CustomerANormalizer } from '../../../src/ingestion/normalizers/customer-a.normalizer';
import { getCustomerConfig } from '../../../src/ingestion/config/customers.config';
import { OrderStatus } from '../../../src/orders/order-status.enum';

const config = getCustomerConfig('freshmart')!;
const normalizer = new CustomerANormalizer(config);

const sample = {
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

describe('CustomerANormalizer', () => {
  it('maps the clean REST payload to canonical', () => {
    const order = normalizer.normalize(sample);

    expect(order.externalOrderId).toBe('FM-100245');
    expect(order.customerId).toBe('freshmart');
    expect(order.orderId).toMatch(/^ord_/);
    expect(order.status).toBe(OrderStatus.RECEIVED);
    expect(order.createdAt).toBe('2026-06-20T14:32:00.000Z');
    expect(order.store).toEqual({
      storeId: 'SP-014',
      name: 'FreshMart Pinheiros',
    });
    expect(order.deliveryAddress.country).toBe('BR');
  });

  it('keeps unit prices as-is and sums the order total', () => {
    const order = normalizer.normalize(sample);
    expect(order.items).toHaveLength(2);
    expect(order.items[0].unitPrice).toEqual({ amount: 5.49, currency: 'BRL' });
    // 6 * 5.49 + 2 * 8.90 = 50.74
    expect(order.total).toEqual({ amount: 50.74, currency: 'BRL' });
  });

  it('dead-letters (throws) when order_id is missing', () => {
    expect(() => normalizer.normalize({ ...sample, order_id: '' })).toThrow(
      /order_id/,
    );
  });
});
