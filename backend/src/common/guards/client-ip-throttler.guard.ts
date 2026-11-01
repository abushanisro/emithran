import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { clientIp } from '../client-ip';

/**
 * The global rate limiter. The auth guard runs first, so the caller is already known here:
 * - a request made with an API key is counted against that key (request.apiKey), so one integration cannot use up the limit of
 *   everyone behind the same address, nor escape its own by changing address;
 * - a signed-in person (request.user, set from the verified Auth0 token) is counted against their user id. Browser traffic reaches
 *   the backend through the Next.js BFF, so all of it has the frontend container as its address; keying it by address would put
 *   every user of every tenant in one bucket per route;
 * - anything else (public routes) is counted by the real client address (see client-ip.ts).
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, any>): Promise<string> {
    const keyId: unknown = req.apiKey?.id;
    if (typeof keyId === 'string' && keyId) return Promise.resolve(`api-key:${keyId}`);
    const userId: unknown = req.user?.id;
    if (typeof userId === 'string' && userId) return Promise.resolve(`user:${userId}`);
    return Promise.resolve(clientIp(req));
  }
}
