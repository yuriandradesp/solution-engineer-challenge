import { NormalizationError } from '../../common/errors';
import type { CanonicalOrder } from '../../orders/canonical-order.model';
import { OrderStatus } from '../../orders/order-status.enum';
import type { CustomerConfig } from '../config/customers.config';

/**
 * A per-customer strategy that maps ONE raw record into a canonical order.
 * Batching (splitting an array / paginated feed into records) is the caller's
 * job; the normalizer only sees a single record and throws
 * {@link NormalizationError} if it can't be mapped.
 */
export interface Normalizer {
  readonly customerId: string;
  normalize(raw: unknown): CanonicalOrder;
}

/** Look up a status in the customer's configured map (case-insensitive). */
export function mapStatus(config: CustomerConfig, raw: string): OrderStatus {
  const key = String(raw).trim().toLowerCase();
  const status = config.statusMap[key];
  if (!status) {
    throw new NormalizationError(
      `Unmapped status "${raw}" for customer ${config.id}`,
    );
  }
  return status;
}
