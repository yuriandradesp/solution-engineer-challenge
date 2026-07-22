import { describe, expect, it } from 'vitest';
import { CustomerBNormalizer } from '../../../src/ingestion/normalizers/customer-b.normalizer';
import { getCustomerConfig } from '../../../src/ingestion/config/customers.config';
import { OrderStatus } from '../../../src/orders/order-status.enum';

const config = getCustomerConfig('bairrobox')!;
const normalizer = new CustomerBNormalizer(config);

describe('CustomerBNormalizer', () => {
  it('splits the delimited item string and derives unit price from the line total', () => {
    const order = normalizer.normalize({
      id: '5582',
      shop: 'BairroBox Centro',
      date: '20/06/2026 11:05',
      situacao: 'Em separacao',
      items: 'Arroz 5kg|x2|59.80;Feijao 1kg|x3|0',
      endereco: 'Av. Paulista 900, Sao Paulo',
      store_code: '',
    });

    expect(order.status).toBe(OrderStatus.PICKING);
    expect(order.items).toHaveLength(2);
    // 59.80 / 2 = 29.90 unit
    expect(order.items[0]).toMatchObject({
      sku: 'ARROZ-5KG',
      name: 'Arroz 5kg',
      quantity: 2,
      unitPrice: { amount: 29.9, currency: 'BRL' },
    });
    // line total is a sum of line totals, not unit * qty
    expect(order.total).toEqual({ amount: 59.8, currency: 'BRL' });
  });

  it('converts dd/mm/yyyy local time to UTC using the configured offset', () => {
    const order = normalizer.normalize({
      id: '5580',
      date: '20/06/2026 10:40',
      situacao: 'Novo',
      items: 'Arroz 5kg|x1|29.90',
      endereco: 'Rua Augusta 500, Sao Paulo',
    });
    // 10:40 at -03:00 → 13:40 UTC
    expect(order.createdAt).toBe('2026-06-20T13:40:00.000Z');
    expect(order.deliveryAddress).toEqual({
      line1: 'Rua Augusta 500',
      city: 'Sao Paulo',
      country: 'BR',
    });
  });

  it('keeps zero-quantity lines as a partial record (unit price 0, not NaN)', () => {
    const order = normalizer.normalize({
      id: '5583',
      date: '20/06/2026 11:18',
      situacao: 'Separado',
      items: 'Cafe 500g|x0|0;Acucar 1kg|x1|6.20',
      endereco: 'Rua Oscar Freire 200, Sao Paulo',
    });
    expect(order.items[0].quantity).toBe(0);
    expect(order.items[0].unitPrice.amount).toBe(0);
    expect(order.total.amount).toBe(6.2);
  });

  it('tolerates an empty address', () => {
    const order = normalizer.normalize({
      id: '5584',
      date: '20/06/2026 11:30',
      situacao: 'Em entrega',
      items: 'Macarrao 500g|x4|19.60',
      endereco: '',
    });
    expect(order.deliveryAddress).toEqual({
      line1: '',
      city: '',
      country: 'BR',
    });
    expect(order.status).toBe(OrderStatus.READY);
  });
});
