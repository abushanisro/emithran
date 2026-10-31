/**
 * App Readiness State Machine
 * 
 * Ensures API calls only execute when the application is fully ready:
 * - Auth is initialized and stable
 * - Backend health is confirmed  
 * - All critical systems are operational
 */

export enum AppReadinessState {
  BOOTING = 'BOOTING',
  AUTH_INITIALIZING = 'AUTH_INITIALIZING', 
  AUTH_READY = 'AUTH_READY',
  BACKEND_READY = 'BACKEND_READY',
  READY = 'READY',
  ERROR = 'ERROR'
}

export interface ReadinessCheckpoint {
  auth: boolean;
  backend: boolean;
  environment: boolean;
}

type ReadinessListener = (state: AppReadinessState, checkpoint: ReadinessCheckpoint) => void;

class AppReadinessManager {
  private currentState: AppReadinessState = AppReadinessState.BOOTING;
  private checkpoint: ReadinessCheckpoint = {
    auth: false,
    backend: false,
    environment: false
  };
  private listeners = new Set<ReadinessListener>();

  constructor() {
    if (typeof window !== 'undefined') {
      // Start checking environment immediately
      this.checkEnvironment();
    }
  }

  /**
   * Get current readiness state
   */
  getState(): AppReadinessState {
    return this.currentState;
  }

  /**
   * Check if app is ready for API calls
   */
  isReady(): boolean {
    return this.currentState === AppReadinessState.READY;
  }

  /**
   * Check if auth is ready (auth initialized and stable)
   */
  isAuthReady(): boolean {
    return this.checkpoint.auth && 
           (this.currentState === AppReadinessState.AUTH_READY || 
            this.currentState === AppReadinessState.BACKEND_READY ||
            this.currentState === AppReadinessState.READY);
  }

  /**
   * Mark auth as initialized but not yet validated
   */
  setAuthInitialized(): void {
    // Don't set auth ready until we validate with backend
  }

  /**
   * Mark auth as validated with backend (after successful authenticated request)
   */
  setAuthValidated(): void {
    if (!this.checkpoint.auth) {
      this.checkpoint.auth = true;
      this.updateState();
    }
  }

  /**
   * Mark backend as healthy and reachable
   */
  setBackendReady(): void {
    if (!this.checkpoint.backend) {
      this.checkpoint.backend = true;
      this.updateState();
    }
  }

  /**
   * Mark environment as validated
   */
  setEnvironmentReady(): void {
    if (!this.checkpoint.environment) {
      this.checkpoint.environment = true;
      this.updateState();
    }
  }

  /**
   * Reset auth readiness (on logout or auth error)
   */
  resetAuth(): void {
    this.checkpoint.auth = false;
    this.updateState();
  }

  /**
   * Reset backend readiness (on connection failure)
   */
  resetBackend(): void {
    this.checkpoint.backend = false;
    this.updateState();
  }

  /**
   * Add readiness state listener
   */
  addListener(listener: ReadinessListener): () => void {
    this.listeners.add(listener);
    
    // Immediately call with current state
    listener(this.currentState, { ...this.checkpoint });
    
    return () => this.listeners.delete(listener);
  }

  /**
   * Update state based on checkpoint progress
   */
  private updateState(): void {
    const prev = this.currentState;
    
    // Determine new state based on checkpoints
    if (!this.checkpoint.environment) {
      this.currentState = AppReadinessState.BOOTING;
    } else if (!this.checkpoint.auth) {
      this.currentState = AppReadinessState.AUTH_INITIALIZING;
    } else if (!this.checkpoint.backend) {
      this.currentState = AppReadinessState.AUTH_READY;
    } else {
      this.currentState = AppReadinessState.READY;
    }

    // Notify listeners if state changed
    if (prev !== this.currentState) {
      this.notifyListeners();
    }
  }

  /**
   * Check environment readiness
   */
  private checkEnvironment(): void {
    try {
      // Basic environment checks
      const hasWindow = typeof window !== 'undefined';
      const hasFetch = typeof fetch !== 'undefined';
      const hasConsole = typeof console !== 'undefined';
      
      if (hasWindow && hasFetch && hasConsole) {
        this.setEnvironmentReady();
      }
    } catch (error) {
      // Environment check failed - app cannot start properly
    }
  }

  /**
   * Notify all listeners
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.currentState, { ...this.checkpoint });
      } catch (error) {
        // Listener error - continue with other listeners
      }
    });
  }
}

// Singleton instance
export const appReadiness = new AppReadinessManager();