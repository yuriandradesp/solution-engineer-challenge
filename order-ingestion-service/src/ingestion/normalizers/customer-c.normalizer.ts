import { isoFromUsDate } from '../../common/date.util';
import { NormalizationError } from '../../common/errors';
import { makeOrderId } from '../../common/hash.util';
import { round2 } from '../../common/util';
import type {
  CanonicalOrder,
  OrderItem,
} from '../../orders/canonical-order.model';
import type { CustomerConfig } from '../config/customers.config';
import { mapStatus, Normalizer } from './normalizer.interface';

interface CustomerCProduct {
  code: string;
  title: string;
  amount: number; // quantity — may be fractional (by weight)
  uom: string;
  line_total: number; // in minor units when money.unit === 'cents'
}

interface CustomerCRaw {
  reference: string;
  location?: { code?: string; label?: string };
  timestamp: string;
  order_status: number;
  money?: { currency?: string; unit?: string };
  products?: CustomerCProduct[];
  destination?: { address?: string; city?: string; country?: string };
}

/**
 * Customer C (GlobalGoods) — international. Money in cents, quantity by weight,
 * full country names, integer status codes, 12h US date. Paginated + rate
 * limited (handled by the poller, not here).
 */
export class CustomerCNormalizer implements Normalizer {
  readonly customerId: string;

  constructor(private readonly config: CustomerConfig) {
    this.customerId = config.id;
  }

  normalize(raw: unknown): CanonicalOrder {
    const r = raw as CustomerCRaw;

    const externalOrderId = String(r.reference ?? '').trim();
    if (!externalOrderId) {
      throw new NormalizationError('missing reference');
    }

    const currency = r.money?.currency ?? this.config.defaultCurrency ?? 'MXN';
    const inCents = r.money?.unit === 'cents';
    const toMajor = (v: number) => (inCents ? v / 100 : v);

    let totalAmount = 0;
    const items: OrderItem[] = (r.products ?? []).map((p) => {
      const lineTotal = toMajor(Number(p.line_total));
      const quantity = Number(p.amount);
      totalAmount += lineTotal;
      return {
        sku: String(p.code ?? ''),
        name: String(p.title ?? ''),
        quantity, // fractional preserved for by-weight items
        unitPrice: {
          amount: quantity > 0 ? round2(lineTotal / quantity) : 0,
          currency,
        },
      };
    });
    if (items.length === 0) {
      throw new NormalizationError('order has no products');
    }

    return {
      orderId: makeOrderId(this.customerId, externalOrderId),
      externalOrderId,
      customerId: this.customerId,
      status: mapStatus(this.config, String(r.order_status)),
      createdAt: isoFromUsDate(r.timestamp, this.config.utcOffset ?? '+00:00'),
      store: {
        storeId: String(r.location?.code ?? ''),
        name: String(r.location?.label ?? ''),
      },
      items,
      total: { amount: round2(totalAmount), currency },
      deliveryAddress: {
        line1: String(r.destination?.address ?? ''),
        city: String(r.destination?.city ?? ''),
        country: this.toIsoCountry(r.destination?.country),
      },
    };
  }

  /** "Mexico" → "MX". An unknown name is left as-is so the canonical
   * validator rejects it (country must be 2 chars) — surfacing a possible
   * contract change rather than silently persisting bad data. */
  private toIsoCountry(name?: string): string {
    const raw = String(name ?? '').trim();
    if (!raw) return this.config.defaultCountry ?? '';
    return this.config.countryMap?.[raw.toLowerCase()] ?? raw;
  }
}
