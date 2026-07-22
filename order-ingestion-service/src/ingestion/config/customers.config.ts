import { OrderStatus } from '../../orders/order-status.enum';

/** How to read a pull customer's HTTP response. */
export type ResponseShape =
  | { mode: 'array' } // body IS the array of records (Customer B)
  | {
      // body is a page object with an array field + a hasMore flag (Customer C)
      mode: 'paginated';
      ordersField: string;
      hasMoreField: string;
      pageParam: string;
      maxPagesPerCycle?: number;
    };

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface PullSourceConfig {
  /** Path appended to MOCKS_BASE_URL, e.g. "/customer-b/orders". */
  path: string;
  /** Poll cadence. Overridable at runtime via DEMO_POLL_INTERVAL_MS. */
  intervalMs: number;
  response: ResponseShape;
  rateLimit?: RateLimitConfig;
}

/**
 * The whole per-customer contract in one place: ingestion BEHAVIOR (mode,
 * interval, rate limit, response shape) AND the declarative MAPPING inputs
 * (status/country dictionaries, currency, timezone). A new customer is a new
 * entry here plus, at most, a small normalizer strategy — not a new pipeline.
 */
export interface CustomerConfig {
  id: string;
  name: string;
  mode: 'push' | 'pull';
  /** Which normalizer strategy turns this customer's raw record canonical. */
  normalizer: 'customer-a' | 'customer-b' | 'customer-c';
  source?: PullSourceConfig; // pull customers only

  // ---- declarative mapping inputs, consumed by the normalizer ----
  /** Fixed UTC offset for timezone-less timestamps (documented simplification). */
  utcOffset?: string;
  defaultCurrency?: string;
  defaultCountry?: string;
  /** Maps the customer's status vocabulary onto the canonical lifecycle.
   * Keys are lowercased before lookup. */
  statusMap: Record<string, OrderStatus>;
  /** Maps full country names onto ISO-3166 alpha-2 (Customer C). */
  countryMap?: Record<string, string>;
}

/**
 * Customer A — FreshMart (Enterprise). Push / webhook. Clean REST JSON,
 * unit prices, ISO timestamps, ISO country + currency already.
 */
const FRESHMART: CustomerConfig = {
  id: 'freshmart',
  name: 'FreshMart',
  mode: 'push',
  normalizer: 'customer-a',
  defaultCurrency: 'BRL',
  defaultCountry: 'BR',
  statusMap: {
    new: OrderStatus.RECEIVED,
    received: OrderStatus.RECEIVED,
    picking: OrderStatus.PICKING,
    packed: OrderStatus.READY,
    ready: OrderStatus.READY,
    delivered: OrderStatus.DELIVERED,
    cancelled: OrderStatus.CANCELLED,
    canceled: OrderStatus.CANCELLED,
  },
};

/**
 * Customer B — BairroBox (SMB). Polled ~15 min. Flat, messy: items as a
 * delimited string, prices are line totals, Portuguese status, some empty
 * fields, no currency, dd/mm/yyyy local time.
 */
const BAIRROBOX: CustomerConfig = {
  id: 'bairrobox',
  name: 'BairroBox',
  mode: 'pull',
  normalizer: 'customer-b',
  utcOffset: '-03:00', // America/Sao_Paulo
  defaultCurrency: 'BRL',
  defaultCountry: 'BR',
  source: {
    path: '/customer-b/orders',
    intervalMs: 15 * 60 * 1000,
    response: { mode: 'array' },
  },
  statusMap: {
    novo: OrderStatus.RECEIVED,
    'em separacao': OrderStatus.PICKING,
    separado: OrderStatus.READY,
    'em entrega': OrderStatus.READY, // out-for-delivery collapses to nearest canonical
    entregue: OrderStatus.DELIVERED,
    cancelado: OrderStatus.CANCELLED,
  },
};

/**
 * Customer C — GlobalGoods (International). Polled 5 min, paginated,
 * rate-limited (60/min). Currency in cents, quantity by weight, full country
 * names, integer status codes, 12h US date.
 */
const GLOBALGOODS: CustomerConfig = {
  id: 'globalgoods',
  name: 'GlobalGoods',
  mode: 'pull',
  normalizer: 'customer-c',
  utcOffset: '-06:00', // America/Mexico_City
  defaultCurrency: 'MXN',
  source: {
    path: '/customer-c/orders',
    intervalMs: 5 * 60 * 1000,
    response: {
      mode: 'paginated',
      ordersField: 'orders',
      hasMoreField: 'hasMore',
      pageParam: 'page',
      maxPagesPerCycle: 50,
    },
    rateLimit: { maxRequests: 60, windowMs: 60_000 },
  },
  // Integer status codes. NOTE: no data dictionary was provided — these are
  // documented assumptions. An unknown code dead-letters (surfacing a possible
  // contract change) rather than guessing.
  statusMap: {
    '1': OrderStatus.RECEIVED,
    '2': OrderStatus.PICKING,
    '3': OrderStatus.READY,
    '4': OrderStatus.DELIVERED,
    '5': OrderStatus.CANCELLED,
  },
  countryMap: {
    mexico: 'MX',
    'estados unidos mexicanos': 'MX',
  },
};

export const CUSTOMER_CONFIGS: CustomerConfig[] = [
  FRESHMART,
  BAIRROBOX,
  GLOBALGOODS,
];

export function getCustomerConfig(id: string): CustomerConfig | undefined {
  return CUSTOMER_CONFIGS.find((c) => c.id === id);
}
