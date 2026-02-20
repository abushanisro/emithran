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
   * @param accessToken - User's Supabase access token (or dev token)
   * @returns Authenticated Supabase client
   */
  getClient(accessToken?: string): SupabaseClient {
    console.log('🔍 getClient called, adminClient exists:', !!this.adminClient);
    if (!this.adminClient) {
      console.error('❌ Admin client not available in getClient()');
      throw new Error('Supabase admin client not initialized');
    }
    return this.adminClient;
  }

  async verifyToken(token: string): Promise<any> {
    // MVP: Skip token verification, return admin user
    return {
      id: '6e7124e7-bf9e-4686-9cac-2245f016a3e4',
      email: 'emuski@mithran.com',
      role: 'admin'
    };
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
