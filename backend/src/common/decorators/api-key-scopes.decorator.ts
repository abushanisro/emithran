import { SetMetadata } from '@nestjs/common';

import type { ApiKeyScope } from '../api-keys/api-key-scopes';

export const API_KEY_SCOPES_KEY = 'apiKeyScopes';

/**
 * Lets an API key call this endpoint when the key holds every listed scope. Endpoints without it refuse API keys (403), so a new
 * endpoint is never reachable by a key by accident. People signed in through Auth0 are not affected.
 *
 * @example
 * @Get()
 * @ApiKeyScopes('projects:read')
 */
export const ApiKeyScopes = (...scopes: [ApiKeyScope, ...ApiKeyScope[]]) => SetMetadata(API_KEY_SCOPES_KEY, scopes);
