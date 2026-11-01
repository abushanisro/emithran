import { createHash } from 'node:crypto';
import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/** The named throttler that caps how often one caller may spend the server's AI (Anthropic) key. */
export const AI_THROTTLER = 'ai';
export const DEFAULT_AI_LIMIT_PER_MINUTE = 20;

const SPENDS_AI = 'emithran:spends-ai';

/**
 * Marks an endpoint that calls the AI provider on the server's key. It is then also counted against the caller's AI budget
 * (AI_LIMIT_PER_MINUTE per minute), on top of the ordinary limit. The budget is one per caller across every marked endpoint, so a
 * user cannot multiply it by spreading calls over several AI routes.
 */
export const SpendsAi = (): MethodDecorator & ClassDecorator => SetMetadata(SPENDS_AI, true);

function spendsAi(context: ExecutionContext): boolean {
  return Reflect.getMetadata(SPENDS_AI, context.getHandler()) === true || Reflect.getMetadata(SPENDS_AI, context.getClass()) === true;
}

type Setting = (name: string, fallback: number) => number;

/**
 * The throttlers every route runs through (ClientIpThrottlerGuard supplies the tracker: user, API key or client address):
 * - default: THROTTLE_LIMIT requests per THROTTLE_TTL ms, per route handler and caller;
 * - ai: AI_LIMIT_PER_MINUTE requests per minute per caller, shared by all @SpendsAi endpoints and skipped everywhere else.
 */
export function throttlerOptions(setting: Setting): ThrottlerModuleOptions {
  return {
    throttlers: [
      { ttl: setting('THROTTLE_TTL', 60_000), limit: setting('THROTTLE_LIMIT', 100) },
      {
        name: AI_THROTTLER,
        ttl: 60_000,
        limit: setting('AI_LIMIT_PER_MINUTE', DEFAULT_AI_LIMIT_PER_MINUTE),
        skipIf: (context) => !spendsAi(context),
        generateKey: (_context, tracker, name) => createHash('sha256').update(`${name}-${tracker}`).digest('hex'),
      },
    ],
  };
}
