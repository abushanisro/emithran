import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { clientIp } from '../client-ip';

/**
 * The global rate limiter, keyed by the real client address instead of the tunnel's (see client-ip.ts). A request made with an API
 * key is counted against that key instead (the auth guard runs first and sets request.apiKey), so one integration cannot use up
 * the limit of everyone behind the same address, nor escape its own by changing address.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, any>): Promise<string> {
    const keyId: unknown = req.apiKey?.id;
    return Promise.resolve(typeof keyId === 'string' && keyId ? `api-key:${keyId}` : clientIp(req));
  }
}
