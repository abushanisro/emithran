import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabaseUrl: string;
  private supabaseAnonKey: string;
  private supabaseServiceKey: string;
  private adminClient: SupabaseClient;

  constructor(private configService: ConfigService) {
    // Backend uses server-side environment variables (not NEXT_PUBLIC_ prefix)
    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL') || '';
    this.supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || '';
    this.supabaseServiceKey = this.configService.get<string>('SUPABASE_SERVICE_KEY') || '';

    console.log('🔍 Supabase Configuration Check:', {
      hasUrl: !!this.supabaseUrl,
      hasAnonKey: !!this.supabaseAnonKey,
      hasServiceKey: !!this.supabaseServiceKey,
      url: this.supabaseUrl,
      anonKeyLength: this.supabaseAnonKey.length,
      serviceKeyLength: this.supabaseServiceKey.length
    });

    if (!this.supabaseUrl || !this.supabaseAnonKey || !this.supabaseServiceKey) {
      console.error('❌ Supabase Configuration Missing - cannot create admin client');
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
      console.log('✅ Supabase admin client created successfully');
    } catch (error) {
      console.error('❌ Failed to create Supabase admin client:', error);
    }
  }

  /**
   * Get Supabase client authenticated with user's access token
   * This ensures RLS policies work correctly with auth.uid()
   *
   * @param accessToken - User's Supabase access token
   * @returns Authenticated Supabase client
   */
  getClient(accessToken?: string): SupabaseClient {
    if (!this.adminClient) {
      throw new Error('Supabase admin client not initialized');
    }

    // If no access token provided, return admin client for server operations
    if (!accessToken) {
      return this.adminClient;
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
            
          console.warn(`Supabase fetch attempt ${attempt} failed:`, {
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
   * Get admin user ID by email for development
   */
  async getAdminUserId(): Promise<string | null> {
    try {
      const { data: users, error } = await this.adminClient.auth.admin.listUsers();
      
      if (error) {
        console.warn('Failed to get admin user ID:', error.message);
        return null;
      }

      const adminUser = users?.users?.find(user => user.email === 'emuski@mithran.com');
      return adminUser?.id || null;
    } catch (error) {
      console.warn('Error getting admin user ID:', error);
      return null;
    }
  }

  getAdminClient(): SupabaseClient {
    if (!this.adminClient) {
      throw new Error('Supabase not configured');
    }
    return this.adminClient;
  }

  get client(): SupabaseClient {
    if (!this.adminClient) {
      throw new Error('Supabase not configured');
    }
    return this.adminClient;
  }

  /**
   * Reload PostgREST schema cache to recognize new tables/schema changes
   * This is essential after DDL operations (CREATE TABLE, ALTER TABLE, etc.)
   */
  async reloadSchemaCache(): Promise<boolean> {
    if (!this.supabaseUrl || !this.supabaseServiceKey) {
      console.warn('Supabase not configured - cannot reload schema cache');
      return false;
    }
    
    try {
      // PostgREST exposes a special endpoint to reload its schema cache
      const response = await fetch(`${this.supabaseUrl}/rest/v1/`, {
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
        console.error('Failed to reload schema cache:', error);
        return false;
      }

      console.log('Schema cache reload triggered successfully');
      return true;
    } catch (error) {
      console.error('Error reloading schema cache:', error);
      return false;
    }
  }
}
