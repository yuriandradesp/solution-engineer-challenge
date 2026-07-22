/** The canonical order lifecycle. Every customer's status vocabulary
 * (English strings, Portuguese strings, integer codes) is mapped onto this. */
export enum OrderStatus {
  RECEIVED = 'received',
  READY = 'ready',
  PICKING = 'picking',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}
