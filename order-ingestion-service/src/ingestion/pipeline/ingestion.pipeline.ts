import { Injectable, Logger } from '@nestjs/common';
import { contentHashOf } from '../../common/hash.util';
import { validateCanonicalOrder } from '../../orders/canonical-order.dto';
import { DeadLetterStore } from '../../orders/dead-letter.store';
import { OrderRepository, UpsertStatus } from '../../orders/order.repository';
import { NormalizerRegistry } from '../normalizers/normalizer.registry';

export interface IngestOutcome {
  outcome: UpsertStatus | 'failed';
  orderId?: string;
  externalOrderId?: string;
  reason?: string;
  errorType?: string;
}

export interface BatchSummary {
  customerId: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
}

/**
 * The one path both ingestion modes (webhook + poller) feed into:
 *   normalize → validate → persist (idempotent upsert)
 * Any bad/partial record is routed to the dead-letter store with a reason and
 * never blocks the rest of the batch. Duplicates collapse to "unchanged" via
 * the repository's content-hash check, so overlapping poll windows and
 * webhook retries are safe.
 */
@Injectable()
export class IngestionPipeline {
  private readonly logger = new Logger(IngestionPipeline.name);

  constructor(
    private readonly normalizers: NormalizerRegistry,
    private readonly orders: OrderRepository,
    private readonly deadLetters: DeadLetterStore,
  ) {}

  ingestRecord(customerId: string, raw: unknown): IngestOutcome {
    try {
      const normalizer = this.normalizers.get(customerId);
      const order = normalizer.normalize(raw);
      validateCanonicalOrder(order);

      const now = new Date().toISOString();
      const result = this.orders.upsert(order, contentHashOf(order), now);
      return {
        outcome: result.status,
        orderId: order.orderId,
        externalOrderId: order.externalOrderId,
      };
    } catch (err) {
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      const reason = err instanceof Error ? err.message : String(err);
      this.deadLetters.record({
        customerId,
        errorType,
        reason,
        rawPayload: raw,
      });
      this.logger.warn(`Dead-lettered ${customerId} record: ${reason}`);
      return { outcome: 'failed', reason, errorType };
    }
  }

  ingestBatch(customerId: string, records: unknown[]): BatchSummary {
    const summary: BatchSummary = {
      customerId,
      total: records.length,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
    };

    for (const record of records) {
      const { outcome } = this.ingestRecord(customerId, record);
      summary[outcome] += 1;
    }

    this.logger.log(
      `[${customerId}] batch of ${summary.total}: ` +
        `${summary.created} created, ${summary.updated} updated, ` +
        `${summary.unchanged} duplicate, ${summary.failed} failed`,
    );
    return summary;
  }
}
