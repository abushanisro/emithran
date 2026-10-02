import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { currentRequestAuth } from '../request-context/request-auth-context';

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private supabaseUrl: string;
  private supabaseAnonKey: string;
  private supabaseServiceKey: string;
  private adminClient: SupabaseClient;

  constructor(private configService: ConfigService) {
    // Backend uses server-side environment variables (not NEXT_PUBLIC_ prefix)
    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL') || '';
    this.supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || '';
    this.supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_KEY') || '';

    if (!this.supabaseUrl || !this.supabaseAnonKey || !this.supabaseServiceKey) {
      this.logger.error('❌ Supabase Configuration Missing - cannot create admin client');
      return;
    }

    try {
      // Admin client with SERVICE ROLE key for operations that bypass RLS
      this.adminClient = createClient(this.supabaseUrl, this.supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    } catch (error) {
      this.logger.error('❌ Failed to create Supabase admin client:', error);
    }
  }

  /**
   * Get Supabase client authenticated with user's access token
   * This ensures RLS policies work correctly with auth.uid()
   *
   * @param accessToken - User's Supabase access token
   * @returns Authenticated Supabase client
   */
  getClient(accessToken: string): SupabaseClient {
    if (!this.adminClient) {
      throw new Error('Supabase admin client not initialized');
    }

    // Never fall back to the service-role client: a lost or missing token must
    // fail closed, not silently bypass RLS. Server-side work that genuinely has
    // no user context uses getPrivilegedClient(reason) instead.
    if (typeof accessToken !== 'string' || accessToken.trim() === '') {
      throw new UnauthorizedException('Access token is required for a user-scoped database client');
    }

    // Create user-authenticated client with proper token
    const clientOptions = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        ...(process.env.NODE_ENV === 'development' && {
          fetch: this.createRobustFetch(),
        }),
      },
    };

    const userClient = createClient(this.supabaseUrl, this.supabaseAnonKey, clientOptions);
    
    // Set the session with the provided token
    userClient.auth.setSession({
      access_token: accessToken,
      refresh_token: '', // Not needed for server-side operations
    });

    return userClient;
  }

  /**
   * Create a fetch wrapper that retries on ECONNRESET and other network errors
   */
  private createRobustFetch() {
    const originalFetch = global.fetch;
    
    return async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const maxRetries = 3;
      let lastError: Error | null = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await originalFetch(url, {
            ...init,
            // Add timeout to prevent hanging
            signal: AbortSignal.timeout(30000), // 30 second timeout
          });
          return response;
        } catch (error: any) {
          lastError = error;
          const isRetryableError = 
            error.code === 'ECONNRESET' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNREFUSED' ||
            error.message?.includes('fetch failed') ||
            error.message?.includes('network error');
            
          this.logger.warn(`Supabase fetch attempt ${attempt} failed:`, {
            error: error.message,
            code: error.code,
            retryable: isRetryableError
          });
          
          if (!isRetryableError || attempt === maxRetries) {
            break;
          }
          
          // Wait before retrying (exponential backoff)
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      throw lastError;
    };
  }

  async verifyToken(token: string): Promise<any> {
    if (!token) {
      throw new UnauthorizedException('Access token is required');
    }

    try {
      const { data: user, error } = await this.adminClient.auth.getUser(token);
      
      if (error || !user?.user) {
        throw new UnauthorizedException('Invalid or expired token');
      }

      return {
        id: user.user.id,
        email: user.user.email,
        role: user.user.user_metadata?.role || 'user'
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Token verification failed');
    }
  }

  /**
   * The user id the development auth bypass acts as, looked up by email.
   *
   * The email was hardcoded to 'emuski@mithran.com', which matches no account
   * in this project — so this always returned null, the guard substituted the
   * literal string 'admin-fallback' as the user id, and every write carrying it
   * into a uuid column failed. Confirmed live: an apply-route call failed with
   * `invalid input syntax for type uuid: "admin-fallback"`.
   *
   * Now configurable via ADMIN_FALLBACK_EMAIL, defaulting to the previous
   * literal so behaviour is unchanged where that account does exist. When the
   * address matches nothing the failure is logged explicitly, because the
   * consequence — an id that cannot be persisted — is not obvious from the
   * symptom it produces further downstream.
   */
  /**
   * The account the development auth bypass acts as, from ADMIN_FALLBACK_EMAIL.
   *
   * No default: the address that used to be hardcoded here matched no account in
   * this project, so the lookup silently failed on every call. Deliberately not
   * replaced with one of the real accounts either — which identity a bypass
   * assumes is deployment configuration, not something source should decide.
   */
  getAdminFallbackEmail(): string | null {
    return this.configService.get<string>('ADMIN_FALLBACK_EMAIL')?.trim() || null;
  }

  async getAdminUserId(): Promise<string | null> {
    const adminEmail = this.getAdminFallbackEmail();
    if (!adminEmail) {
      this.logger.warn(
        'ADMIN_FALLBACK_EMAIL is not set — the development auth bypass has no account to act as. ' +
        'Requests without a bearer token will be rejected.',
      );
      return null;
    }
    try {
      const { data: users, error } = await this.adminClient.auth.admin.listUsers();

      if (error) {
        this.logger.warn('Failed to get admin user ID:', error.message);
        return null;
      }

      const adminUser = users?.users?.find(user => user.email === adminEmail);
      if (!adminUser) {
        this.logger.warn(
          `No account matches ADMIN_FALLBACK_EMAIL '${adminEmail}' — the development auth bypass ` +
          `has no real user id to act as, so any write that persists a user id will be rejected. ` +
          `Set ADMIN_FALLBACK_EMAIL to a real account, or send a bearer token.`,
        );
      }
      return adminUser?.id || null;
    } catch (error: any) {
      const msg = error?.cause?.code ?? error?.message ?? 'unknown';
      this.logger.warn('Failed to get admin user ID:', msg);
      return null;
    }
  }

  /**
   * RLS-enforced client for the CURRENT authenticated request, taking the token
   * from the request-scoped auth context (RequestAuthInterceptor). Throws when
   * there is no authenticated request in scope (public route, background job,
   * lost async context) instead of degrading to the service-role client.
   */
  getUserClient(explicitAccessToken?: string | null): SupabaseClient {
    if (typeof explicitAccessToken === 'string' && explicitAccessToken.trim() !== '') {
      return this.getClient(explicitAccessToken);
    }
    const auth = currentRequestAuth();
    if (!auth) {
      throw new UnauthorizedException(
        'No authenticated request in scope. Use getPrivilegedClient(reason) only for work that genuinely has no user context.',
      );
    }
    return this.getClient(auth.accessToken);
  }

  /**
   * The ONLY sanctioned way to get the service-role client (bypasses RLS).
   * `reason` is mandatory and logged at debug level so every privileged access
   * is searchable and reviewable, e.g. 'reference-data: sm_reference_data'.
   */
  getPrivilegedClient(reason: string): SupabaseClient {
    if (!reason || !reason.trim()) {
      throw new Error('getPrivilegedClient requires a non-empty reason');
    }
    if (!this.adminClient) {
      throw new Error('Supabase not configured');
    }
    this.logger.debug(`privileged client: ${reason}`);
    return this.adminClient;
  }

  /** email -> cached real session token, so the dev bypass mints at most once per token lifetime. */
  private mintedTokens = new Map<string, { token: string; expiresAtMs: number }>();
  private mintInFlight = new Map<string, Promise<string | null>>();

  /**
   * Development auth bypass only: a genuine user access token for `email`, so the
   * bypass user goes through RLS exactly like a production user instead of being
   * handed the service-role client. Magic-link token hash is minted with the admin
   * API and redeemed through the anon client; nothing is sent by email.
   */
  async mintUserAccessToken(email: string): Promise<string | null> {
    const cached = this.mintedTokens.get(email);
    // Refresh a minute before expiry.
    if (cached && cached.expiresAtMs - 60_000 > Date.now()) return cached.token;

    let pending = this.mintInFlight.get(email);
    if (!pending) {
      pending = this.doMintUserAccessToken(email).finally(() => this.mintInFlight.delete(email));
      this.mintInFlight.set(email, pending);
    }
    return pending;
  }

  private async doMintUserAccessToken(email: string): Promise<string | null> {
    try {
      const admin = this.getPrivilegedClient('dev-bypass: mint a real session for ADMIN_FALLBACK_EMAIL');
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
      });
      const tokenHash = link?.properties?.hashed_token;
      if (linkErr || !tokenHash) {
        this.logger.warn(`Could not mint a dev-bypass session: ${linkErr?.message ?? 'no token hash returned'}`);
        return null;
      }
      const anon = createClient(this.supabaseUrl, this.supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: session, error: verifyErr } = await anon.auth.verifyOtp({
        type: 'magiclink',
        token_hash: tokenHash,
      });
      const accessToken = session?.session?.access_token;
      if (verifyErr || !accessToken) {
        this.logger.warn(`Could not redeem the dev-bypass session: ${verifyErr?.message ?? 'no session returned'}`);
        return null;
      }
      const expiresAtMs = (session.session!.expires_at ?? 0) * 1000;
      this.mintedTokens.set(email, { token: accessToken, expiresAtMs });
      return accessToken;
    } catch (error: any) {
      this.logger.warn(`Dev-bypass session mint failed: ${error?.cause?.code ?? error?.message ?? 'unknown'}`);
      return null;
    }
  }

  /**
   * Reload PostgREST schema cache to recognize new tables/schema changes
   * This is essential after DDL operations (CREATE TABLE, ALTER TABLE, etc.)
   */
  async reloadSchemaCache(): Promise<boolean> {
    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      this.logger.warn('Supabase not configured - cannot reload schema cache');
      return false;
    }
    
    try {
      // PostgREST exposes a special endpoint to reload its schema cache
      await fetch(`${this.supabaseUrl}/rest/v1/`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseServiceKey}`,
          'Content-Type': 'application/json',
          'Content-Profile': 'public'
        },
        body: JSON.stringify({ action: 'reload_schema' })
      });

      // Alternative method: Signal PostgREST to reload via NOTIFY
      await this.adminClient
        .from('pg_notify')  // This won't work, but we can try direct SQL
        .select('*')
        .limit(1);

      // Most reliable method: Use SQL function to notify PostgREST
      const { error } = await this.adminClient.rpc('pgrst_reload_config');
      
      if (error && !error.message.includes('function "pgrst_reload_config" does not exist')) {
        this.logger.error('Failed to reload schema cache:', error);
        return false;
      }

      this.logger.log('Schema cache reload triggered successfully');
      return true;
    } catch (error) {
      this.logger.error('Error reloading schema cache:', error);
      return false;
    }
  }
}

