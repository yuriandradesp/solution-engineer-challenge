import { Injectable } from '@nestjs/common';
import { NormalizationError } from '../../common/errors';
import { CUSTOMER_CONFIGS, CustomerConfig } from '../config/customers.config';
import { CustomerANormalizer } from './customer-a.normalizer';
import { CustomerBNormalizer } from './customer-b.normalizer';
import { CustomerCNormalizer } from './customer-c.normalizer';
import { Normalizer } from './normalizer.interface';

/** Builds and hands out the right normalizer strategy per customerId,
 * driven entirely by config. Adding a customer that fits an existing shape
 * is a config entry; a genuinely new shape adds one strategy class here. */
@Injectable()
export class NormalizerRegistry {
  private readonly normalizers = new Map<string, Normalizer>();

  constructor() {
    for (const config of CUSTOMER_CONFIGS) {
      this.normalizers.set(config.id, this.build(config));
    }
  }

  get(customerId: string): Normalizer {
    const normalizer = this.normalizers.get(customerId);
    if (!normalizer) {
      throw new NormalizationError(`No normalizer for customer ${customerId}`);
    }
    return normalizer;
  }

  private build(config: CustomerConfig): Normalizer {
    switch (config.normalizer) {
      case 'customer-a':
        return new CustomerANormalizer(config);
      case 'customer-b':
        return new CustomerBNormalizer(config);
      case 'customer-c':
        return new CustomerCNormalizer(config);
      default: {
        const kind: string = config.normalizer;
        throw new NormalizationError(
          `Unknown normalizer "${kind}" for ${config.id}`,
        );
      }
    }
  }
}
