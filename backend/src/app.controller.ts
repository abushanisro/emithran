interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Logger, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { SupabaseService } from './common/supabase/supabase.service';

@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor(private supabaseService: SupabaseService) {
    this.logger.log('🚀 AppController initialized');
  }

  @Public()
  @Get()
  healthCheck() {
    this.logger.log('✅ Root route / accessed');
    return {
      success: true,
      data: {
        service: 'mithran-api-gateway',
        status: 'healthy',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    };
  }

  @Public()
  @Get('ping')
  ping() {
    return {
      success: true,
      data: {
        pong: true,
        timestamp: new Date().toISOString(),
      },
    };
  }

  @Public()
  @Get('test')
  test() {
    return { message: 'AppController is working!' };
  }

  @Public()
  @Get('supabase-test')
  async testSupabase() {
    try {
      const client = this.supabaseService.getAdminClient();
      
      // Test different endpoints to isolate the issue
      const tests = [];
      
      // Test 1: Auth admin endpoint
      try {
        const { data: authData, error: authError } = await client.auth.admin.listUsers({ page: 1, perPage: 1 });
        tests.push({ name: 'auth.admin.listUsers', success: !authError, error: authError?.message });
      } catch (e) {
        tests.push({ name: 'auth.admin.listUsers', success: false, error: e.message });
      }
      
      // Test 2: Simple database query
      try {
        const { data: dbData, error: dbError } = await client.from('projects').select('count').limit(1);
        tests.push({ name: 'projects.select', success: !dbError, error: dbError?.message });
      } catch (e) {
        tests.push({ name: 'projects.select', success: false, error: e.message });
      }
      
      // Test 3: Raw REST API call
      try {
        const response = await fetch(`https://iuvtsvjpmovfymvnmqys.supabase.co/rest/v1/projects?select=count&limit=1`, {
          headers: {
            'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1dnRzdmpwbW92Znltdm5tcXlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjYwMTA4MiwiZXhwIjoyMDgyMTc3MDgyfQ.6w6TW548bPe1-kHC8e6h7GUJrqGksXHFNEixd-4wa_g',
            'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1dnRzdmpwbW92Znltdm5tcXlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjYwMTE4MiwiZXhwIjoyMDgyMTc3MDgyfQ.6w6TW548bPe1-kHC8e6h7GUJrqGksXHFNEixd-4wa_g'
          }
        });
        tests.push({ 
          name: 'raw.rest.api', 
          success: response.ok, 
          error: response.ok ? null : `HTTP ${response.status}: ${response.statusText}`,
          status: response.status
        });
      } catch (e) {
        tests.push({ name: 'raw.rest.api', success: false, error: e.message });
      }
      
      return {
        success: true,
        hasClient: !!client,
        projectUrl: 'https://iuvtsvjpmovfymvnmqys.supabase.co',
        tests: tests
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        hasClient: false
      };
    }
  }
}