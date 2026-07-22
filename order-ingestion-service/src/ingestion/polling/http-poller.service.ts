import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sleep } from '../../common/util';
import {
  CUSTOMER_CONFIGS,
  CustomerConfig,
  PullSourceConfig,
} from '../config/customers.config';
import { IngestionPipeline } from '../pipeline/ingestion.pipeline';
import { RateLimiter } from './rate-limiter';

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 500;

/**
 * Scheduled poller for pull customers (B, C). One timer per customer at its
 * configured interval; a first poll fires immediately on boot. Features:
 *  - per-customer rate limiting (token/window) before every request
 *  - 429 handling that respects Retry-After, plus exponential backoff on 5xx
 *  - pagination for paginated feeds (page=1..N until hasMore is false)
 *  - overlap guard so a slow cycle never stacks on top of itself
 * Dedup of the overlapping windows the mocks return is handled downstream by
 * the pipeline's idempotent upsert.
 */
@Injectable()
export class HttpPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HttpPollerService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly limiters = new Map<string, RateLimiter>();
  private readonly inFlight = new Set<string>();
  private baseUrl!: string;

  constructor(
    private readonly pipeline: IngestionPipeline,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('POLLING_ENABLED') === 'false') {
      this.logger.warn('Polling disabled (POLLING_ENABLED=false)');
      return;
    }
    this.baseUrl =
      this.config.get<string>('MOCKS_BASE_URL') ?? 'http://localhost:4000';
    const override = Number(this.config.get<string>('DEMO_POLL_INTERVAL_MS'));

    for (const customer of CUSTOMER_CONFIGS) {
      if (customer.mode !== 'pull' || !customer.source) continue;

      if (customer.source.rateLimit) {
        this.limiters.set(
          customer.id,
          new RateLimiter(
            customer.source.rateLimit.maxRequests,
            customer.source.rateLimit.windowMs,
          ),
        );
      }

      const intervalMs = override > 0 ? override : customer.source.intervalMs;
      this.logger.log(
        `Scheduling poller for ${customer.id} every ${intervalMs}ms`,
      );

      void this.poll(customer); // immediate first cycle
      this.timers.push(setInterval(() => void this.poll(customer), intervalMs));
    }
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearInterval(t));
  }

  private async poll(customer: CustomerConfig): Promise<void> {
    if (this.inFlight.has(customer.id)) {
      this.logger.warn(
        `Skipping ${customer.id} poll — previous cycle still running`,
      );
      return;
    }
    this.inFlight.add(customer.id);
    try {
      const records = await this.fetchRecords(customer.source!, customer.id);
      this.pipeline.ingestBatch(customer.id, records);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Poll failed for ${customer.id}: ${reason}`);
    } finally {
      this.inFlight.delete(customer.id);
    }
  }

  private async fetchRecords(
    source: PullSourceConfig,
    customerId: string,
  ): Promise<unknown[]> {
    if (source.response.mode === 'array') {
      const body = await this.getJson(this.baseUrl + source.path, customerId);
      return Array.isArray(body) ? (body as unknown[]) : [];
    }

    const { ordersField, hasMoreField, pageParam, maxPagesPerCycle } =
      source.response;
    const records: unknown[] = [];
    const maxPages = maxPagesPerCycle ?? 50;

    for (let page = 1; page <= maxPages; page++) {
      const url = `${this.baseUrl}${source.path}?${pageParam}=${page}`;
      const body = (await this.getJson(url, customerId)) as Record<
        string,
        unknown
      >;
      const pageOrders = body?.[ordersField];
      if (Array.isArray(pageOrders)) records.push(...(pageOrders as unknown[]));
      if (!body?.[hasMoreField]) break;
      if (page === maxPages) {
        this.logger.warn(
          `${customerId}: hit maxPagesPerCycle=${maxPages}, stopping pagination early`,
        );
      }
    }
    return records;
  }

  /** GET with rate limiting, 429/Retry-After handling and 5xx backoff. */
  private async getJson(url: string, customerId: string): Promise<unknown> {
    const limiter = this.limiters.get(customerId);

    for (let attempt = 0; ; attempt++) {
      if (limiter) await limiter.acquire();
      const res = await fetch(url);

      if (res.status === 429) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(`${url} -> 429 after ${MAX_RETRIES} retries`);
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.backoff(attempt);
        this.logger.warn(
          `${customerId}: 429 from ${url}, backing off ${waitMs}ms`,
        );
        await sleep(waitMs);
        continue;
      }

      if (res.status >= 500) {
        if (attempt >= MAX_RETRIES) {
          throw new Error(
            `${url} -> ${res.status} after ${MAX_RETRIES} retries`,
          );
        }
        await sleep(this.backoff(attempt));
        continue;
      }

      if (!res.ok) {
        throw new Error(`${url} -> ${res.status}`);
      }
      return res.json();
    }
  }

  private backoff(attempt: number): number {
    return BASE_BACKOFF_MS * 2 ** attempt;
  }
}
