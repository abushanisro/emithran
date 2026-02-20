/**
 * Environment Configuration Validator
 * Production-grade validation | 2026 Best Practices
 * Clean, Fast, Reliable
 */

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface EnvironmentConfig {
  api: {
    baseUrl: string;
    isReachable: boolean;
  };
  supabase: {
    url: string;
    anonKey: string;
    isConfigured: boolean;
  };
  app: {
    url: string;
    environment: 'development' | 'production' | 'test';
  };
}

class EnvironmentValidator {
  private static instance: EnvironmentValidator;
  private validationResult: ValidationResult | null = null;
  private config: EnvironmentConfig | null = null;

  private constructor() {}

  static getInstance(): EnvironmentValidator {
    if (!EnvironmentValidator.instance) {
      EnvironmentValidator.instance = new EnvironmentValidator();
    }
    return EnvironmentValidator.instance;
  }

  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // API Configuration - Critical
    const apiUrl = this.getApiUrl();
    if (!apiUrl) {
      errors.push('API_URL is required');
    } else if (!this.isValidUrl(apiUrl)) {
      errors.push('Invalid API_URL format');
    }

    // Supabase Configuration
    const supabaseUrl = this.getEnvVar('NEXT_PUBLIC_SUPABASE_URL');
    const supabaseKey = this.getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const hasSupabase = !!(supabaseUrl && supabaseKey && supabaseKey.startsWith('eyJ'));

    // Debug logging for production
    if (process.env.NODE_ENV === 'production' && typeof window === 'undefined') {
      console.log('Environment validation - Supabase URL exists:', !!supabaseUrl);
      console.log('Environment validation - Supabase Key exists:', !!supabaseKey);
      console.log('Environment validation - Supabase Key format valid:', supabaseKey ? supabaseKey.startsWith('eyJ') : false);
    }

    // Production-specific validations
    if (process.env.NODE_ENV === 'production') {
      if (apiUrl?.includes('localhost')) {
        errors.push('Production cannot use localhost API');
      }
      // Only validate Supabase on client-side after page load (not during SSR/build)
      // Skip validation during build/SSR phase or if DOM not ready
      if (typeof window !== 'undefined' && 
          document?.readyState === 'complete' && 
          !hasSupabase && 
          !process.env.SKIP_ENV_VALIDATION) {
        warnings.push('Supabase configuration recommended for production');
      }
    }

    this.validationResult = { isValid: errors.length === 0, errors, warnings };

    // Store config
    this.config = {
      api: {
        baseUrl: apiUrl || '',
        isReachable: false,
      },
      supabase: {
        url: supabaseUrl || '',
        anonKey: supabaseKey || '',
        isConfigured: hasSupabase,
      },
      app: {
        url: this.getEnvVar('NEXT_PUBLIC_APP_URL') || '',
        environment: (process.env.NODE_ENV as any) || 'development',
      },
    };

    return this.validationResult;
  }

  getValidationResult(): ValidationResult {
    return this.validationResult || this.validate();
  }

  getConfig(): EnvironmentConfig {
    if (!this.config) this.validate();
    return this.config!;
  }

  setApiReachable(reachable: boolean): void {
    if (this.config) this.config.api.isReachable = reachable;
  }

  async checkApiReachability(): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    const apiUrl = this.getApiUrl();
    if (!apiUrl) return false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${apiUrl.replace('/v1/api', '').replace('/api/v1', '')}/ping`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const isReachable = response.ok;
      this.setApiReachable(isReachable);
      return isReachable;
    } catch {
      this.setApiReachable(false);
      return false;
    }
  }

  async logResults(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (process.env.NODE_ENV === 'production') return; // No logging in production

    const result = this.getValidationResult();
    const config = this.getConfig();

    const apiReachable = await this.checkApiReachability();

    // Validation completed - results available through getValidationResult()
  }

  private getApiUrl(): string {
    // Server-side: prioritize server-only API_URL for security
    // Client-side: use public API_URL
    return typeof window === 'undefined'
      ? process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || ''
      : process.env.NEXT_PUBLIC_API_URL || '';
  }

  private getEnvVar(key: string): string {
    // Try multiple sources for environment variables
    const value = process.env[key] || 
                  (typeof window !== 'undefined' ? (window as any)?.ENV?.[key] : '') || 
                  '';
    return value;
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

export const envValidator = EnvironmentValidator.getInstance();
export type { ValidationResult, EnvironmentConfig };
