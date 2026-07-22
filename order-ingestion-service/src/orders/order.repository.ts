import type { CanonicalOrder, StoredOrder } from './canonical-order.model';

export type UpsertStatus = 'created' | 'updated' | 'unchanged';

export interface UpsertResult {
  status: UpsertStatus;
  order: StoredOrder;
}

/**
 * Persistence port. The pipeline depends only on this abstraction, so the
 * backing store (SQLite in prod, in-memory in unit tests) is swappable.
 *
 * `upsert` carries the idempotency contract:
 *  - unseen orderId          → insert  → 'created'
 *  - seen, same contentHash  → no-op   → 'unchanged'  (pure duplicate)
 *  - seen, different hash    → update  → 'updated'    (real state change)
 */
export abstract class OrderRepository {
  abstract upsert(
    order: CanonicalOrder,
    contentHash: string,
    now: string,
  ): UpsertResult;
  abstract findAll(): StoredOrder[];
  abstract findById(orderId: string): StoredOrder | null;
  abstract count(): number;
}
