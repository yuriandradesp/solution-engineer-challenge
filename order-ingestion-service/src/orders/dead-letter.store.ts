import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface DeadLetter {
  id: string;
  customerId: string;
  errorType: string;
  reason: string;
  rawPayload: unknown;
  receivedAt: string;
}

export interface RecordDeadLetter {
  customerId: string;
  errorType: string;
  reason: string;
  rawPayload: unknown;
}

/**
 * Holds records that failed normalization or validation, with the reason,
 * so mapping failures are inspectable (GET /orders/failures) instead of
 * silently dropped.
 *
 * In-memory ring buffer (most recent first) for the take-home; in production
 * this would be a durable dead-letter queue / table that supports replay.
 */
@Injectable()
export class DeadLetterStore {
  private readonly items: DeadLetter[] = [];
  private readonly maxItems = 500;

  record(input: RecordDeadLetter): DeadLetter {
    const receivedAt = new Date().toISOString();
    const id =
      'dlq_' +
      createHash('sha256')
        .update(`${receivedAt}:${JSON.stringify(input.rawPayload)}`)
        .digest('hex')
        .slice(0, 16);
    const entry: DeadLetter = { id, receivedAt, ...input };
    this.items.unshift(entry);
    if (this.items.length > this.maxItems) this.items.length = this.maxItems;
    return entry;
  }

  findAll(): DeadLetter[] {
    return [...this.items];
  }

  count(): number {
    return this.items.length;
  }
}
