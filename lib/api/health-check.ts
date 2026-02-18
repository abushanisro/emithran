/**
 * Service Health Check & Availability Detection
 *
 * Enterprise-grade health monitoring with:
 * - Automatic health checks
 * - Service discovery
 * - Graceful degradation
 * - Real-time status tracking
 * - Performance monitoring
 */

export enum ServiceStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNHEALTHY = 'UNHEALTHY',
  UNKNOWN = 'UNKNOWN',
}

export interface HealthCheckResult {
  status: ServiceStatus;
  responseTime: number;
  timestamp: number;
  error?: string;
  details?: Record<string, any>;
}

export interface ServiceHealth {
  status: ServiceStatus;
  lastCheck: number;
  lastHealthyTime: number;
  consecutiveFailures: number;
  averageResponseTime: number;
  uptime: number;
}

type HealthCheckListener = (health: ServiceHealth) => void;

/**
 * Service Health Monitor
 * Tracks health status of backend API and provides real-time updates
 */
class HealthCheckManager {
  private static instance: HealthCheckManager;
  private health: ServiceHealth;
  private listeners: HealthCheckListener[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private isChecking = false;

  private readonly CHECK_INTERVAL = 30000; // 30 seconds
  private readonly TIMEOUT = 5000; // 5 seconds
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  private constructor() {
    this.health = {
      status: ServiceStatus.UNKNOWN,
      lastCheck: 0,
      lastHealthyTime: 0,
      consecutiveFailures: 0,
      averageResponseTime: 0,
      uptime: 0,
    };
  }

  static getInstance(): HealthCheckManager {
    if (!HealthCheckManager.instance) {
      HealthCheckManager.instance = new HealthCheckManager();
    }
    return HealthCheckManager.instance;
  }

  /**
   * Start periodic health checks
   */
  startMonitoring(baseUrl: string): void {
    if (typeof window === 'undefined') return; // Server-side only needs initial check

    // Initial check
    this.performHealthCheck(baseUrl);

    // Periodic checks
    if (!this.checkInterval) {
      this.checkInterval = setInterval(() => {
        this.performHealthCheck(baseUrl);
      }, this.CHECK_INTERVAL);
    }
  }

  /**
   * Stop periodic health checks
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Perform a single health check
   */
  async performHealthCheck(baseUrl: string): Promise<HealthCheckResult> {
    if (this.isChecking) {
      return {
        status: this.health.status,
        responseTime: this.health.averageResponseTime,
        timestamp: this.health.lastCheck,
      };
    }

    this.isChecking = true;
    const startTime = Date.now();
    const checkTimestamp = startTime;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

      // Try to hit the health endpoint or a lightweight endpoint
      // Health endpoint is now version-neutral at /api/health
      const healthUrl = baseUrl.includes('/api/v1') 
        ? baseUrl.replace('/api/v1', '/api/health')
        : `${baseUrl}/api/health`;
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      if (response.ok) {
        // Service is healthy
        this.updateHealth({
          status: ServiceStatus.HEALTHY,
          responseTime,
          timestamp: checkTimestamp,
        });
      } else if (response.status >= 500) {
        // Server error - degraded service
        this.updateHealth({
          status: ServiceStatus.DEGRADED,
          responseTime,
          timestamp: checkTimestamp,
          error: `Server returned ${response.status}`,
        });
      } else {
        // Client error (4xx) - still reachable but something's wrong
        this.updateHealth({
          status: ServiceStatus.DEGRADED,
          responseTime,
          timestamp: checkTimestamp,
          error: `Unexpected response: ${response.status}`,
        });
      }

      return {
        status: this.health.status,
        responseTime,
        timestamp: checkTimestamp,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // Service is unreachable
      this.updateHealth({
        status: ServiceStatus.UNHEALTHY,
        responseTime,
        timestamp: checkTimestamp,
        error: error instanceof Error ? error.message : 'Service unreachable',
      });

      return {
        status: ServiceStatus.UNHEALTHY,
        responseTime,
        timestamp: checkTimestamp,
        error: error instanceof Error ? error.message : 'Service unreachable',
      };
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Quick connectivity check (faster than full health check)
   */
  async quickCheck(baseUrl: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout

      const response = await fetch(baseUrl, {
        method: 'HEAD',
        signal: controller.signal,
        cache: 'no-store',
      });

      clearTimeout(timeoutId);
      return response.ok || response.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Update health status
   */
  private updateHealth(result: HealthCheckResult): void {
    const now = Date.now();

    if (result.status === ServiceStatus.HEALTHY) {
      this.health.consecutiveFailures = 0;
      this.health.lastHealthyTime = now;
    } else {
      this.health.consecutiveFailures++;
    }

    // Calculate uptime percentage
    if (this.health.lastCheck > 0) {
      const totalTime = now - this.health.lastCheck;
      const healthyTime = result.status === ServiceStatus.HEALTHY ? totalTime : 0;
      this.health.uptime =
        (this.health.uptime * 0.95) + (healthyTime / totalTime) * 0.05; // Exponential moving average
    }

    // Update average response time
    if (this.health.averageResponseTime === 0) {
      this.health.averageResponseTime = result.responseTime;
    } else {
      this.health.averageResponseTime =
        (this.health.averageResponseTime * 0.8) + (result.responseTime * 0.2);
    }

    // Determine final status based on consecutive failures
    if (this.health.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      this.health.status = ServiceStatus.UNHEALTHY;
    } else if (this.health.consecutiveFailures > 0) {
      this.health.status = ServiceStatus.DEGRADED;
    } else {
      this.health.status = result.status;
    }

    this.health.lastCheck = now;

    // Notify listeners
    this.notifyListeners();
  }

  /**
   * Get current health status
   */
  getHealth(): ServiceHealth {
    return { ...this.health };
  }

  /**
   * Check if service is available
   */
  isAvailable(): boolean {
    return this.health.status === ServiceStatus.HEALTHY ||
           this.health.status === ServiceStatus.DEGRADED;
  }

  /**
   * Check if service is healthy
   */
  isHealthy(): boolean {
    return this.health.status === ServiceStatus.HEALTHY;
  }

  /**
   * Add health status listener
   */
  addListener(listener: HealthCheckListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove health status listener
   */
  removeListener(listener: HealthCheckListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Notify all listeners of health status change
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getHealth());
      } catch (error) {
        // Error in health check listener - silently ignored
      }
    });
  }

  /**
   * Reset health state (useful for testing)
   */
  reset(): void {
    this.health = {
      status: ServiceStatus.UNKNOWN,
      lastCheck: 0,
      lastHealthyTime: 0,
      consecutiveFailures: 0,
      averageResponseTime: 0,
      uptime: 0,
    };
    this.stopMonitoring();
  }
}

export const healthCheckManager = HealthCheckManager.getInstance();
