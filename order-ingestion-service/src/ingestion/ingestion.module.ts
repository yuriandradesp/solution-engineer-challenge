import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { NormalizerRegistry } from './normalizers/normalizer.registry';
import { IngestionPipeline } from './pipeline/ingestion.pipeline';
import { HttpPollerService } from './polling/http-poller.service';
import { WebhookController } from './webhook/webhook.controller';
import { WebhookSignatureGuard } from './webhook/signature.guard';

/** Wires both ingestion modes (webhook + poller) into the shared pipeline. */
@Module({
  imports: [OrdersModule],
  controllers: [WebhookController],
  providers: [
    NormalizerRegistry,
    IngestionPipeline,
    HttpPollerService,
    WebhookSignatureGuard,
  ],
})
export class IngestionModule {}
