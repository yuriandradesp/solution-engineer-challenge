import { isoFromIso } from '../../common/date.util';
import { NormalizationError } from '../../common/errors';
import { makeOrderId } from '../../common/hash.util';
import { round2 } from '../../common/util';
import type {
  CanonicalOrder,
  OrderItem,
} from '../../orders/canonical-order.model';
import type { CustomerConfig } from '../config/customers.config';
import { mapStatus, Normalizer } from './normalizer.interface';

interface CustomerALine {
  sku: string;
  desc: string;
  qty: number;
  price: number; // unit price
}

interface CustomerARaw {
  order_id: string;
  store_id?: string;
  store_name?: string;
  placed_at: string;
  state: string;
  currency?: string;
  lines?: CustomerALine[];
  ship_to?: { street?: string; city?: string; country?: string };
}

/**
 * Customer A (FreshMart) — clean REST JSON. Near 1:1: prices are already unit
 * prices, timestamps are ISO, country/currency already ISO codes.
 */
export class CustomerANormalizer implements Normalizer {
  readonly customerId: string;

  constructor(private readonly config: CustomerConfig) {
    this.customerId = config.id;
  }

  normalize(raw: unknown): CanonicalOrder {
    const r = raw as CustomerARaw;

    const externalOrderId = String(r.order_id ?? '').trim();
    if (!externalOrderId) {
      throw new NormalizationError('missing order_id');
    }

    const currency = r.currency ?? this.config.defaultCurrency ?? 'BRL';

    const items: OrderItem[] = (r.lines ?? []).map((l) => ({
      sku: String(l.sku ?? ''),
      name: String(l.desc ?? ''),
      quantity: Number(l.qty),
      unitPrice: { amount: round2(Number(l.price)), currency },
    }));
    if (items.length === 0) {
      throw new NormalizationError('order has no line items');
    }

    const totalAmount = items.reduce(
      (sum, i) => sum + i.unitPrice.amount * i.quantity,
      0,
    );

    return {
      orderId: makeOrderId(this.customerId, externalOrderId),
      externalOrderId,
      customerId: this.customerId,
      status: mapStatus(this.config, r.state),
      createdAt: isoFromIso(r.placed_at),
      store: {
        storeId: String(r.store_id ?? ''),
        name: String(r.store_name ?? ''),
      },
      items,
      total: { amount: round2(totalAmount), currency },
      deliveryAddress: {
        line1: String(r.ship_to?.street ?? ''),
        city: String(r.ship_to?.city ?? ''),
        country: String(r.ship_to?.country ?? this.config.defaultCountry ?? ''),
      },
    };
  }
}
