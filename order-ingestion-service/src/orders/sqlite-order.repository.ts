import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncCtor } from 'node:sqlite';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CanonicalOrder, StoredOrder } from './canonical-order.model';
import { OrderRepository, UpsertResult } from './order.repository';

// Load the built-in lazily via require so bundlers/test runners (Vite) don't
// try to statically resolve the `node:sqlite` specifier. Types come from the
// erased `import type` above.
const { DatabaseSync } = createRequire(__filename)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncCtor;
};

interface OrderRow {
  payload: string;
  contentHash: string;
  ingestedAt: string;
  updatedAt: string;
}

/**
 * SQLite persistence via Node's built-in `node:sqlite` (no native build step).
 *
 * The `orders` table has orderId as PRIMARY KEY — the database itself enforces
 * one row per canonical order, so idempotency holds even under concurrent
 * writers. The full canonical order is stored as a JSON `payload`; a few
 * columns are promoted for indexing/inspection.
 */
@Injectable()
export class SqliteOrderRepository
  extends OrderRepository
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SqliteOrderRepository.name);
  private db!: DatabaseSyncCtor;

  constructor(private readonly config: ConfigService) {
    super();
  }

  onModuleInit(): void {
    const path = this.config.get<string>('DB_PATH') ?? './data/orders.sqlite';
    if (path !== ':memory:') {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.migrate();
    this.logger.log(`SQLite store ready at ${path}`);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        orderId         TEXT PRIMARY KEY,
        externalOrderId TEXT NOT NULL,
        customerId      TEXT NOT NULL,
        status          TEXT NOT NULL,
        createdAt       TEXT NOT NULL,
        contentHash     TEXT NOT NULL,
        ingestedAt      TEXT NOT NULL,
        updatedAt       TEXT NOT NULL,
        payload         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customerId);
      CREATE INDEX IF NOT EXISTS idx_orders_updated  ON orders(updatedAt);
    `);
  }

  upsert(
    order: CanonicalOrder,
    contentHash: string,
    now: string,
  ): UpsertResult {
    const existing = this.db
      .prepare('SELECT contentHash, ingestedAt FROM orders WHERE orderId = ?')
      .get(order.orderId) as
      { contentHash: string; ingestedAt: string } | undefined;

    const payload = JSON.stringify(order);

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO orders
             (orderId, externalOrderId, customerId, status, createdAt,
              contentHash, ingestedAt, updatedAt, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          order.orderId,
          order.externalOrderId,
          order.customerId,
          order.status,
          order.createdAt,
          contentHash,
          now,
          now,
          payload,
        );
      return {
        status: 'created',
        order: { ...order, contentHash, ingestedAt: now, updatedAt: now },
      };
    }

    if (existing.contentHash === contentHash) {
      return {
        status: 'unchanged',
        order: {
          ...order,
          contentHash,
          ingestedAt: existing.ingestedAt,
          updatedAt: existing.ingestedAt,
        },
      };
    }

    this.db
      .prepare(
        `UPDATE orders
            SET externalOrderId = ?, customerId = ?, status = ?, createdAt = ?,
                contentHash = ?, updatedAt = ?, payload = ?
          WHERE orderId = ?`,
      )
      .run(
        order.externalOrderId,
        order.customerId,
        order.status,
        order.createdAt,
        contentHash,
        now,
        payload,
        order.orderId,
      );
    return {
      status: 'updated',
      order: {
        ...order,
        contentHash,
        ingestedAt: existing.ingestedAt,
        updatedAt: now,
      },
    };
  }

  findAll(): StoredOrder[] {
    const rows = this.db
      .prepare(
        'SELECT payload, contentHash, ingestedAt, updatedAt FROM orders ORDER BY updatedAt DESC',
      )
      .all() as unknown as OrderRow[];
    return rows.map((r) => this.hydrate(r));
  }

  findById(orderId: string): StoredOrder | null {
    const row = this.db
      .prepare(
        'SELECT payload, contentHash, ingestedAt, updatedAt FROM orders WHERE orderId = ?',
      )
      .get(orderId) as OrderRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM orders').get() as {
      c: number;
    };
    return Number(row.c);
  }

  onModuleDestroy(): void {
    this.db?.close();
  }

  private hydrate(row: OrderRow): StoredOrder {
    return {
      ...(JSON.parse(row.payload) as CanonicalOrder),
      contentHash: row.contentHash,
      ingestedAt: row.ingestedAt,
      updatedAt: row.updatedAt,
    };
  }
}
