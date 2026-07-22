import { isoFromBrazilianDate } from '../../common/date.util';
import { NormalizationError } from '../../common/errors';
import { makeOrderId } from '../../common/hash.util';
import { round2, slugify } from '../../common/util';
import type {
  CanonicalOrder,
  DeliveryAddress,
  OrderItem,
} from '../../orders/canonical-order.model';
import type { CustomerConfig } from '../config/customers.config';
import { mapStatus, Normalizer } from './normalizer.interface';

interface CustomerBRaw {
  id: string;
  shop?: string;
  date: string;
  situacao: string;
  items: string; // "Name|xQTY|LINETOTAL;Name|xQTY|LINETOTAL"
  endereco?: string;
  store_code?: string;
}

/**
 * Customer B (BairroBox) — flat & messy. Items are a delimited string, prices
 * are LINE totals (not unit), status is Portuguese, some fields are empty, no
 * currency, and the date is dd/mm/yyyy in local time.
 */
export class CustomerBNormalizer implements Normalizer {
  readonly customerId: string;

  constructor(private readonly config: CustomerConfig) {
    this.customerId = config.id;
  }

  normalize(raw: unknown): CanonicalOrder {
    const r = raw as CustomerBRaw;

    const externalOrderId = String(r.id ?? '').trim();
    if (!externalOrderId) {
      throw new NormalizationError('missing id');
    }

    const currency = this.config.defaultCurrency ?? 'BRL';
    const { items, totalAmount } = this.parseItems(r.items, currency);
    if (items.length === 0) {
      throw new NormalizationError('no parseable line items');
    }

    return {
      orderId: makeOrderId(this.customerId, externalOrderId),
      externalOrderId,
      customerId: this.customerId,
      status: mapStatus(this.config, r.situacao),
      createdAt: isoFromBrazilianDate(
        r.date,
        this.config.utcOffset ?? '+00:00',
      ),
      store: {
        storeId: String(r.store_code ?? '').trim(),
        name: String(r.shop ?? '').trim(),
      },
      items,
      total: { amount: round2(totalAmount), currency },
      deliveryAddress: this.parseAddress(r.endereco),
    };
  }

  /**
   * "Arroz 5kg|x2|59.80;Feijao 1kg|x3|0" → items with derived unit prices.
   * Line total is divided by quantity to get unit price; qty 0 yields unit 0
   * (kept, not dropped — a partial record, surfaced but not fatal).
   */
  private parseItems(
    rawItems: string,
    currency: string,
  ): { items: OrderItem[]; totalAmount: number } {
    const segments = String(rawItems ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    const items: OrderItem[] = [];
    let totalAmount = 0;

    for (const segment of segments) {
      const parts = segment.split('|').map((p) => p.trim());
      if (parts.length < 3) continue; // malformed segment, skip
      const name = parts[0];
      const quantity = parseInt(parts[1].replace(/[^\d.-]/g, ''), 10) || 0;
      const lineTotal = Number(parts[2]) || 0;
      if (!name) continue;

      const unitAmount = quantity > 0 ? round2(lineTotal / quantity) : 0;
      items.push({
        sku: slugify(name), // B carries no SKU; derive a stable one
        name,
        quantity,
        unitPrice: { amount: unitAmount, currency },
      });
      totalAmount += lineTotal;
    }

    return { items, totalAmount };
  }

  /** "Rua Augusta 500, Sao Paulo" → { line1, city }. Empty is allowed
   * (partial record); country defaults from config. */
  private parseAddress(endereco?: string): DeliveryAddress {
    const country = this.config.defaultCountry ?? 'BR';
    const text = String(endereco ?? '').trim();
    if (!text) {
      return { line1: '', city: '', country };
    }
    const parts = text.split(',').map((p) => p.trim());
    if (parts.length === 1) {
      return { line1: parts[0], city: '', country };
    }
    const city = parts.pop() as string;
    return { line1: parts.join(', '), city, country };
  }
}
