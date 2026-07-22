import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsString,
  Length,
  Min,
  validateSync,
  ValidateNested,
  ValidationError,
} from 'class-validator';
import { ValidationFailedError } from '../common/errors';
import type { CanonicalOrder } from './canonical-order.model';
import { OrderStatus } from './order-status.enum';

class MoneyDto {
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;
}

class StoreDto {
  @IsString()
  storeId!: string;

  @IsString()
  name!: string;
}

class OrderItemDto {
  @IsString()
  sku!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @ValidateNested()
  @Type(() => MoneyDto)
  unitPrice!: MoneyDto;
}

class DeliveryAddressDto {
  @IsString()
  line1!: string;

  @IsString()
  city!: string;

  @IsString()
  @Length(2, 2)
  country!: string;
}

/** class-validator schema for the canonical order. */
export class CanonicalOrderDto {
  @IsString()
  @IsNotEmpty()
  orderId!: string;

  @IsString()
  @IsNotEmpty()
  externalOrderId!: string;

  @IsString()
  @IsNotEmpty()
  customerId!: string;

  @IsEnum(OrderStatus)
  status!: OrderStatus;

  @IsISO8601()
  createdAt!: string;

  @ValidateNested()
  @Type(() => StoreDto)
  store!: StoreDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items!: OrderItemDto[];

  @ValidateNested()
  @Type(() => MoneyDto)
  total!: MoneyDto;

  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  deliveryAddress!: DeliveryAddressDto;
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) {
      out.push(`${path} (${Object.values(e.constraints).join(', ')})`);
    }
    if (e.children?.length) {
      out.push(...flatten(e.children, path));
    }
  }
  return out;
}

/**
 * Validate a normalized order against the canonical schema.
 * Throws {@link ValidationFailedError} with a flattened reason on failure.
 */
export function validateCanonicalOrder(order: CanonicalOrder): void {
  const dto = plainToInstance(CanonicalOrderDto, order);
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: false,
  });
  if (errors.length > 0) {
    throw new ValidationFailedError(flatten(errors).join('; '));
  }
}
