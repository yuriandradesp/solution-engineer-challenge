import { Injectable } from '@nestjs/common';
import type { CanonicalOrder, StoredOrder } from './canonical-order.model';
import { OrderRepository, UpsertResult } from './order.repository';

/** Map-backed implementation. Used by unit tests and as a zero-infra
 * fallback; the idempotency logic here mirrors the SQLite adapter. */
@Injectable()
export class InMemoryOrderRepository extends OrderRepository {
  private readonly store = new Map<string, StoredOrder>();

  upsert(
    order: CanonicalOrder,
    contentHash: string,
    now: string,
  ): UpsertResult {
    const existing = this.store.get(order.orderId);

    if (!existing) {
      const stored: StoredOrder = {
        ...order,
        contentHash,
        ingestedAt: now,
        updatedAt: now,
      };
      this.store.set(order.orderId, stored);
      return { status: 'created', order: stored };
    }

    if (existing.contentHash === contentHash) {
      return { status: 'unchanged', order: existing };
    }

    const stored: StoredOrder = {
      ...order,
      contentHash,
      ingestedAt: existing.ingestedAt,
      updatedAt: now,
    };
    this.store.set(order.orderId, stored);
    return { status: 'updated', order: stored };
  }

  findAll(): StoredOrder[] {
    return [...this.store.values()].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  findById(orderId: string): StoredOrder | null {
    return this.store.get(orderId) ?? null;
  }

  count(): number {
    return this.store.size;
  }
}
