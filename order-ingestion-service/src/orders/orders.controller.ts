import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { success, SuccessResponse } from '../utils/http-response';
import type { StoredOrder } from './canonical-order.model';
import { DeadLetter, DeadLetterStore } from './dead-letter.store';
import { OrderRepository } from './order.repository';

/** Read API over the normalized store and the mapping-failure feed.
 * Doubles as the data source for the optional orders UI. */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrderRepository,
    private readonly deadLetters: DeadLetterStore,
  ) {}

  @Get()
  list(): SuccessResponse<StoredOrder[]> {
    const orders = this.orders.findAll();
    return success(`${orders.length} normalized orders`, orders);
  }

  @Get('stats')
  stats(): SuccessResponse<{ orders: number; failures: number }> {
    return success('ingestion stats', {
      orders: this.orders.count(),
      failures: this.deadLetters.count(),
    });
  }

  @Get('failures')
  failures(): SuccessResponse<DeadLetter[]> {
    const failures = this.deadLetters.findAll();
    return success(`${failures.length} mapping failures`, failures);
  }

  @Get(':orderId')
  byId(@Param('orderId') orderId: string): SuccessResponse<StoredOrder> {
    const order = this.orders.findById(orderId);
    if (!order) {
      throw new NotFoundException(`No order with id ${orderId}`);
    }
    return success('order', order);
  }
}
