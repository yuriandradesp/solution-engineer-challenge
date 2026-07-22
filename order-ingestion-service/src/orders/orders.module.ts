import { Module } from '@nestjs/common';
import { DeadLetterStore } from './dead-letter.store';
import { OrderRepository } from './order.repository';
import { OrdersController } from './orders.controller';
import { SqliteOrderRepository } from './sqlite-order.repository';

/** Owns persistence: the canonical order store and the dead-letter store.
 * Swap `useClass` to change the backing store without touching callers. */
@Module({
  controllers: [OrdersController],
  providers: [
    { provide: OrderRepository, useClass: SqliteOrderRepository },
    DeadLetterStore,
  ],
  exports: [OrderRepository, DeadLetterStore],
})
export class OrdersModule {}
