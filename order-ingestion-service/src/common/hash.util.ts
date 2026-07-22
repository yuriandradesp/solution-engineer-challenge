import { createHash } from 'node:crypto';
import type { CanonicalOrder } from '../orders/canonical-order.model';

/**
 * System-generated, stable, idempotent order id.
 *
 * Deterministically derived from (customerId, externalOrderId), so the SAME
 * underlying order — re-delivered by an overlapping poll window or a webhook
 * retry — always hashes to the SAME orderId. That is what makes the upsert in
 * the repository idempotent.
 */
export function makeOrderId(
  customerId: string,
  externalOrderId: string,
): string {
  const digest = createHash('sha256')
    .update(`${customerId}:${externalOrderId}`)
    .digest('hex');
  return `ord_${digest.slice(0, 24)}`;
}

/**
 * Content fingerprint of a normalized order. Two ingests of the same order
 * with identical content produce the same hash (→ a no-op "unchanged"
 * upsert); a genuine change (e.g. status moving Novo → Entregue) produces a
 * different hash (→ an "updated" upsert). This lets us dedup pure repeats
 * while still recording real state transitions.
 */
export function contentHashOf(order: CanonicalOrder): string {
  // orderId/customerId/externalOrderId are stable by construction; hashing the
  // whole canonical object is enough because normalizers build fields in a
  // deterministic order.
  return createHash('sha256').update(JSON.stringify(order)).digest('hex');
}
