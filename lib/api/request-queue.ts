/**
 * Request Queue Manager
 * 
 * Enterprise-grade solution for handling API requests during app initialization:
 * - Queues requests until auth/backend is ready
 * - Prevents race conditions and false connection failures
 * - Industry standard pattern for SPA applications
 * - Automatic retry with exponential backoff
 */

import { appReadiness, AppReadinessState } from '@/lib/core/app-readiness';
import { logger } from '@/lib/utils/logger';

interface QueuedRequest {
  id: string;
  executor: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  priority: 'low' | 'normal' | 'high';
}

type RequestQueueListener = (queueSize: number) => void;

class RequestQueueManager {
  private static instance: RequestQueueManager;
  private queue: QueuedRequest[] = [];
  private isProcessing = false;
  private listeners = new Set<RequestQueueListener>();
  private readinessUnsubscribe: (() => void) | null = null;

  private readonly MAX_QUEUE_SIZE = 50;
  private readonly REQUEST_TIMEOUT = 30000; // 30 seconds
  private readonly PROCESSING_DELAY = 100; // 100ms between requests

  private constructor() {
    // Only initialize in browser environment
    if (typeof window !== 'undefined') {
      // Listen for app readiness changes
      this.readinessUnsubscribe = appReadiness.addListener((state) => {
        if (state === AppReadinessState.READY) {
          this.processQueue();
        }
      });

      // Process queue periodically even if not fully ready (for public endpoints)
      setInterval(() => this.processPublicRequests(), 1000);
    }
  }

  static getInstance(): RequestQueueManager {
    if (!RequestQueueManager.instance) {
      RequestQueueManager.instance = new RequestQueueManager();
    }
    return RequestQueueManager.instance;
  }

  /**
   * Add a request to the queue or execute immediately if ready
   */
  async enqueue<T>(
    id: string,
    executor: () => Promise<T>,
    options: {
      priority?: 'low' | 'normal' | 'high';
      maxRetries?: number;
      bypassQueue?: boolean; // For public endpoints like health checks
    } = {}
  ): Promise<T> {
    const {
      priority = 'normal',
      maxRetries = 3,
      bypassQueue = false
    } = options;

    // If app is ready or this is a bypass request, execute immediately
    if (bypassQueue || appReadiness.isReady()) {
      return executor();
    }

    // Check queue size limit
    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      // Remove oldest low-priority request to make room
      const lowPriorityIndex = this.queue.findIndex(req => req.priority === 'low');
      if (lowPriorityIndex >= 0) {
        const removed = this.queue.splice(lowPriorityIndex, 1)[0];
        removed?.reject(new Error('Request queue full - request was dropped'));
      } else {
        throw new Error('Request queue is full - please try again later');
      }
    }

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest = {
        id,
        executor: executor as () => Promise<any>,
        resolve,
        reject,
        timestamp: Date.now(),
        retryCount: 0,
        maxRetries,
        priority
      };

      // Insert based on priority
      if (priority === 'high') {
        this.queue.unshift(request);
      } else if (priority === 'low') {
        this.queue.push(request);
      } else {
        // Normal priority - insert in middle
        const lowPriorityIndex = this.queue.findIndex(req => req.priority === 'low');
        if (lowPriorityIndex >= 0) {
          this.queue.splice(lowPriorityIndex, 0, request);
        } else {
          this.queue.push(request);
        }
      }

      this.notifyListeners();

      // Set timeout for request
      setTimeout(() => {
        const index = this.queue.findIndex(req => req.id === id);
        if (index >= 0) {
          const timedOutRequest = this.queue.splice(index, 1)[0];
          timedOutRequest?.reject(new Error('Request timeout - app took too long to initialize'));
          this.notifyListeners();
        }
      }, this.REQUEST_TIMEOUT);
    });
  }

  /**
   * Process public requests (health checks, etc.) even when not fully ready
   */
  private async processPublicRequests(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    // Find public/health requests that can be processed early
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const request = this.queue[i];
      if (!request) continue;

      // Check if this is a health check or public endpoint
      if (request.id.includes('health') || request.id.includes('public')) {
        const processedRequest = this.queue.splice(i, 1)[0];
        if (processedRequest) {
          this.executeRequest(processedRequest);
        }
        this.notifyListeners();
        break; // Process one at a time
      }
    }
  }

  /**
   * Process all queued requests when app becomes ready
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    logger.info(`Processing ${this.queue.length} queued requests`, {}, 'RequestQueue');

    while (this.queue.length > 0) {
      const request = this.queue.shift()!;
      await this.executeRequest(request);
      this.notifyListeners();

      // Small delay between requests to prevent overwhelming backend
      await this.sleep(this.PROCESSING_DELAY);
    }

    this.isProcessing = false;
    logger.info('Request queue processing complete', {}, 'RequestQueue');
  }

  /**
   * Execute a single request with retry logic
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    try {
      const result = await request.executor();
      request.resolve(result);
    } catch (error) {
      // Retry logic
      if (request.retryCount < request.maxRetries) {
        request.retryCount++;
        
        // Exponential backoff
        const backoffDelay = Math.min(
          1000 * Math.pow(2, request.retryCount - 1),
          10000 // Max 10 seconds
        );
        
        logger.warn('Retrying queued request', {
          id: request.id,
          attempt: request.retryCount,
          backoffDelay,
          error: error instanceof Error ? error.message : String(error)
        }, 'RequestQueue');

        setTimeout(() => {
          this.executeRequest(request);
        }, backoffDelay);
      } else {
        request.reject(error);
      }
    }
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      queueSize: this.queue.length,
      isProcessing: this.isProcessing,
      isAppReady: appReadiness.isReady(),
      appState: appReadiness.getState(),
      queueBreakdown: {
        high: this.queue.filter(req => req.priority === 'high').length,
        normal: this.queue.filter(req => req.priority === 'normal').length,
        low: this.queue.filter(req => req.priority === 'low').length,
      }
    };
  }

  /**
   * Clear all queued requests (useful for logout)
   */
  clearQueue(): void {
    this.queue.forEach(request => {
      request.reject(new Error('Request queue cleared'));
    });
    this.queue = [];
    this.notifyListeners();
  }

  /**
   * Add queue size listener
   */
  addListener(listener: RequestQueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of queue size change
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.queue.length);
      } catch (error) {
        // Silent fail for listeners
      }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.readinessUnsubscribe) {
      this.readinessUnsubscribe();
      this.readinessUnsubscribe = null;
    }
    this.clearQueue();
  }
}

// Export singleton instance
export const requestQueue = RequestQueueManager.getInstance();

// Export types
export type { QueuedRequest, RequestQueueListener };