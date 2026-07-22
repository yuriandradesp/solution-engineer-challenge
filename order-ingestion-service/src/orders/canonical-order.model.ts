import { OrderStatus } from './order-status.enum';

export interface Money {
  amount: number;
  currency: string; // ISO-4217
}

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: Money;
}

export interface Store {
  storeId: string;
  name: string;
}

export interface DeliveryAddress {
  line1: string;
  city: string;
  country: string; // ISO-3166 alpha-2
}

/** The single shape the rest of the platform sees, regardless of which
 * customer the data came from or how it arrived. */
export interface CanonicalOrder {
  orderId: string; // system-generated, stable, idempotent
  externalOrderId: string; // the customer's own id
  customerId: string; // which integration this came from
  status: OrderStatus;
  createdAt: string; // ISO-8601 UTC
  store: Store;
  items: OrderItem[];
  total: Money;
  deliveryAddress: DeliveryAddress;
}

/** A persisted order plus bookkeeping the store adds. */
export interface StoredOrder extends CanonicalOrder {
  contentHash: string;
  ingestedAt: string; // first time we saw this orderId
  updatedAt: string; // last time its content changed
}
