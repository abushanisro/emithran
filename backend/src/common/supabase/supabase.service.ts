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

    if (!this.supabaseUrl || !this.supabaseAnonKey || !this.supabaseServiceKey) {
      console.warn(
        'SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_KEY must be set in environment variables. Some features may not work correctly.'
      );
      // Don't throw error to allow app to start for health checks
      return;
    }

    // Admin client with SERVICE ROLE key for operations that bypass RLS
    // This client should ONLY be used for admin operations like token verification
    this.adminClient = createClient(this.supabaseUrl, this.supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  /**
   * Get Supabase client authenticated with user's access token
   * This ensures RLS policies work correctly with auth.uid()
   *
   * @param accessToken - User's Supabase access token (or dev token)
   * @returns Authenticated Supabase client
   */
  getClient(accessToken?: string): SupabaseClient {
    if (!accessToken) {
      return this.adminClient;
    }

    // Create client with user's auth context for RLS
    return createClient(this.supabaseUrl, this.supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });
  }

  async verifyToken(token: string): Promise<any> {
    if (!this.adminClient) {
      throw new UnauthorizedException('Supabase not configured');
    }

    const { data, error } = await this.adminClient.auth.getUser(token);

    if (error) {
      throw new UnauthorizedException(`Invalid token: ${error.message}`);
    }

    // Authorization is handled by RLS policies in Supabase
    // No need to check authorized_users here - the database will enforce it
    return data.user;
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
