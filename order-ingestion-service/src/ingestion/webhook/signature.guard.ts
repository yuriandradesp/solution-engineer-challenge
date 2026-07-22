import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Optional HMAC-SHA256 webhook signature check. Active only when
 * WEBHOOK_SECRET is set; otherwise it no-ops so the sample payload works out
 * of the box.
 *
 * NOTE: this HMACs a re-serialization of the parsed body. A production
 * implementation must HMAC the RAW request bytes (bodies can re-serialize
 * differently), typically via a raw-body middleware.
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('WEBHOOK_SECRET');
    if (!secret) return true; // verification disabled

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      body: unknown;
    }>();

    const provided = req.headers['x-signature'];
    if (!provided) {
      throw new UnauthorizedException('missing x-signature header');
    }

    const expected = createHmac('sha256', secret)
      .update(JSON.stringify(req.body ?? ''))
      .digest('hex');

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn('Rejected webhook: bad signature');
      throw new UnauthorizedException('invalid signature');
    }
    return true;
  }
}
