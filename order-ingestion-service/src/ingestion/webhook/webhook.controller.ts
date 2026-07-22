import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { success, SuccessResponse } from '../../utils/http-response';
import { getCustomerConfig } from '../config/customers.config';
import {
  BatchSummary,
  IngestOutcome,
  IngestionPipeline,
} from '../pipeline/ingestion.pipeline';
import { WebhookSignatureGuard } from './signature.guard';

/**
 * Push ingestion (Customer A). Receives an order (or a batch) and acknowledges
 * fast with 202. Accepts either a single order object or an array.
 *
 * At this scale we run the pipeline inline; at production scale the handler
 * would only enqueue the raw payload and return 202 immediately (see DESIGN.md).
 */
@Controller('webhooks')
@UseGuards(WebhookSignatureGuard)
export class WebhookController {
  constructor(private readonly pipeline: IngestionPipeline) {}

  @Post(':customerId')
  @HttpCode(202)
  receive(
    @Param('customerId') customerId: string,
    @Body() body: unknown,
  ): SuccessResponse<IngestOutcome | BatchSummary> {
    const config = getCustomerConfig(customerId);
    if (!config) {
      throw new NotFoundException(`Unknown customer "${customerId}"`);
    }
    if (config.mode !== 'push') {
      throw new BadRequestException(
        `Customer "${customerId}" is a ${config.mode} integration, not a webhook`,
      );
    }

    if (Array.isArray(body)) {
      return success('accepted', this.pipeline.ingestBatch(customerId, body));
    }
    return success('accepted', this.pipeline.ingestRecord(customerId, body));
  }
}
