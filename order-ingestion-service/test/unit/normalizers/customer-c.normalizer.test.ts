import { describe, expect, it } from 'vitest';
import { CustomerCNormalizer } from '../../../src/ingestion/normalizers/customer-c.normalizer';
import { getCustomerConfig } from '../../../src/ingestion/config/customers.config';
import { OrderStatus } from '../../../src/orders/order-status.enum';

const config = getCustomerConfig('globalgoods')!;
const normalizer = new CustomerCNormalizer(config);

describe('CustomerCNormalizer', () => {
  it('converts cents to major units and weight-based quantities', () => {
    const order = normalizer.normalize({
      reference: 'GG_77531',
      location: { code: 'MX-CDMX-02', label: 'GlobalGoods Polanco' },
      timestamp: '06-20-2026 09:15 AM',
      order_status: 1,
      money: { currency: 'MXN', unit: 'cents' },
      products: [
        {
          code: 'A12',
          title: 'Avocado (by kg)',
          amount: 1.5,
          uom: 'kg',
          line_total: 13500,
        },
        {
          code: 'B07',
          title: 'Tortillas 1kg',
          amount: 2,
          uom: 'unit',
          line_total: 4400,
        },
      ],
      destination: {
        address: 'Av. Masaryk 111',
        city: 'Mexico City',
        country: 'Mexico',
      },
    });

    expect(order.status).toBe(OrderStatus.RECEIVED);
    // 13500c = 135.00, qty 1.5kg → unit 90.00
    expect(order.items[0]).toMatchObject({
      sku: 'A12',
      quantity: 1.5,
      unitPrice: { amount: 90, currency: 'MXN' },
    });
    expect(order.items[1].unitPrice.amount).toBe(22); // 4400c / 2
    expect(order.total).toEqual({ amount: 179, currency: 'MXN' });
  });

  it('maps full country name to ISO and 12h US date to UTC', () => {
    const order = normalizer.normalize({
      reference: 'GG_77530',
      location: { code: 'MX-CDMX-01', label: 'GlobalGoods Reforma' },
      timestamp: '06-20-2026 08:50 AM',
      order_status: 1,
      money: { currency: 'MXN', unit: 'cents' },
      products: [
        {
          code: 'C03',
          title: 'Tortilla de Maiz 1kg',
          amount: 1,
          uom: 'unit',
          line_total: 3200,
        },
      ],
      destination: {
        address: 'Paseo de la Reforma 222',
        city: 'Mexico City',
        country: 'Mexico',
      },
    });
    expect(order.deliveryAddress.country).toBe('MX');
    // 08:50 at -06:00 → 14:50 UTC
    expect(order.createdAt).toBe('2026-06-20T14:50:00.000Z');
  });

  it('dead-letters (throws) on an unmapped integer status code', () => {
    expect(() =>
      normalizer.normalize({
        reference: 'GG_9',
        timestamp: '06-20-2026 08:50 AM',
        order_status: 99,
        money: { currency: 'MXN', unit: 'cents' },
        products: [
          { code: 'X', title: 'X', amount: 1, uom: 'unit', line_total: 100 },
        ],
        destination: { country: 'Mexico' },
      }),
    ).toThrow(/status/i);
  });
});
