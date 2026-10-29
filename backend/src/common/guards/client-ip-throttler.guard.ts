import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { clientIp } from '../client-ip';

/** The global rate limiter, keyed by the real client address instead of the tunnel's (see client-ip.ts). */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(clientIp(req));
  }
}
