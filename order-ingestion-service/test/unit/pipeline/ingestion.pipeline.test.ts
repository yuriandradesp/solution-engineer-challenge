import { beforeEach, describe, expect, it } from 'vitest';
import { IngestionPipeline } from '../../../src/ingestion/pipeline/ingestion.pipeline';
import { NormalizerRegistry } from '../../../src/ingestion/normalizers/normalizer.registry';
import { InMemoryOrderRepository } from '../../../src/orders/in-memory-order.repository';
import { DeadLetterStore } from '../../../src/orders/dead-letter.store';

function makePipeline() {
  const repo = new InMemoryOrderRepository();
  const deadLetters = new DeadLetterStore();
  const pipeline = new IngestionPipeline(
    new NormalizerRegistry(),
    repo,
    deadLetters,
  );
  return { pipeline, repo, deadLetters };
}

const bOrder = (over: Record<string, unknown> = {}) => ({
  id: '5582',
  shop: 'BairroBox Centro',
  date: '20/06/2026 11:05',
  situacao: 'Em separacao',
  items: 'Arroz 5kg|x2|59.80',
  endereco: 'Av. Paulista 900, Sao Paulo',
  store_code: '',
  ...over,
});

describe('IngestionPipeline idempotency', () => {
  let ctx: ReturnType<typeof makePipeline>;
  beforeEach(() => {
    ctx = makePipeline();
  });

  it('creates once and treats an identical re-poll as unchanged', () => {
    expect(ctx.pipeline.ingestRecord('bairrobox', bOrder()).outcome).toBe(
      'created',
    );
    expect(ctx.pipeline.ingestRecord('bairrobox', bOrder()).outcome).toBe(
      'unchanged',
    );
    expect(ctx.repo.count()).toBe(1);
  });

  it('updates when the same external order changes status', () => {
    ctx.pipeline.ingestRecord('bairrobox', bOrder({ situacao: 'Novo' }));
    const second = ctx.pipeline.ingestRecord(
      'bairrobox',
      bOrder({ situacao: 'Entregue' }),
    );
    expect(second.outcome).toBe('updated');
    expect(ctx.repo.count()).toBe(1);
    expect(ctx.repo.findById(second.orderId!)?.status).toBe('delivered');
  });

  it('produces a stable orderId across re-polls', () => {
    const a = ctx.pipeline.ingestRecord('bairrobox', bOrder());
    const b = ctx.pipeline.ingestRecord('bairrobox', bOrder());
    expect(a.orderId).toBe(b.orderId);
  });

  it('dead-letters a bad record without dropping the rest of the batch', () => {
    const summary = ctx.pipeline.ingestBatch('bairrobox', [
      bOrder({ id: '1', items: 'Arroz 5kg|x1|29.90' }),
      bOrder({ id: '2', situacao: 'Estado Invalido' }), // unmapped status → fails
      bOrder({ id: '3', items: 'Feijao 1kg|x1|10.00' }),
    ]);
    expect(summary.created).toBe(2);
    expect(summary.failed).toBe(1);
    expect(ctx.deadLetters.count()).toBe(1);
    expect(ctx.deadLetters.findAll()[0].customerId).toBe('bairrobox');
  });
});

describe('IngestionPipeline dedup across overlapping poll windows', () => {
  it('dedups the duplicate row the mock feed repeats within a window', () => {
    const { pipeline, repo } = makePipeline();
    // BairroBox fixture repeats id 5582 within the same window
    const summary = pipeline.ingestBatch('bairrobox', [
      bOrder({ id: '5580', items: 'Arroz 5kg|x1|29.90', situacao: 'Novo' }),
      bOrder({ id: '5581', situacao: 'Em separacao' }),
      bOrder({ id: '5582' }),
      bOrder({ id: '5582' }), // duplicate
    ]);
    expect(summary.total).toBe(4);
    expect(summary.created).toBe(3);
    expect(summary.unchanged).toBe(1);
    expect(repo.count()).toBe(3);
  });
});
