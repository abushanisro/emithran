/**
 * CAD Engine API Client
 * 
 * Professional STEP to STL conversion service integration
 * Handles file validation, conversion, and error management
 */

import { config } from '../config';

export interface ConversionResult {
  success: true;
  originalFilename: string;
  stlFilename: string;
  stlSize: number;
  stlBase64: string;
  meshQuality: {
    linearDeflection: number;
    angularDeflection: number;
  };
}

export interface ConversionError {
  success: false;
  error: string;
  detail?: string;
}

export interface CADEngineHealth {
  status: string;
  opencascade: string;
  capabilities: string[];
  limits: {
    maxFileSizeMb: number;
    rateLimitPerMinute: number;
  };
  conversionSettings: {
    linearDeflection: number;
    angularDeflection: number;
  };
}

export class CADEngineClient {
  private readonly baseUrl: string;
  private readonly maxFileSize: number;
  private readonly supportedFormats: string[];

  constructor() {
    this.baseUrl = config.cadEngine.baseUrl;
    this.maxFileSize = config.cadEngine.maxFileSize;
    this.supportedFormats = config.cadEngine.supportedFormats;
  }

  /**
   * Check if file is supported for conversion
   */
  isFileSupported(filename: string): boolean {
    const extension = this.getFileExtension(filename);
    return this.supportedFormats.includes(extension);
  }

  /**
   * Validate file before conversion
   */
  validateFile(file: File): { valid: boolean; error?: string } {
    // Check file size
    if (file.size > this.maxFileSize) {
      return {
        valid: false,
        error: `File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${this.maxFileSize / 1024 / 1024}MB)`
      };
    }

    // Check file format
    if (!this.isFileSupported(file.name)) {
      return {
        valid: false,
        error: `Unsupported file format. Supported formats: ${this.supportedFormats.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Convert STEP file to STL (binary download)
   */
  async convertToStl(file: File): Promise<Blob> {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${this.baseUrl}/convert/step-to-stl`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Conversion failed: ${errorText}`);
      }

      return await response.blob();
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Network error during conversion');
    }
  }

  /**
   * Convert STEP file to STL (base64 response)
   */
  async convertToStlBase64(file: File): Promise<ConversionResult> {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${this.baseUrl}/convert/step-to-stl-base64`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || 'Conversion failed');
      }

      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Network error during conversion');
    }
  }

  /**
   * Check CAD Engine health status
   */
  async getHealthStatus(): Promise<CADEngineHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      
      if (!response.ok) {
        throw new Error('Health check failed');
      }

      return await response.json();
    } catch (error) {
      throw new Error('Unable to connect to CAD Engine');
    }
  }

  /**
   * Download STL file from blob
   */
  downloadStlBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.changeFileExtension(filename, '.stl');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Download STL file from base64 data
   */
  downloadStlBase64(base64Data: string, filename: string): void {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    this.downloadStlBlob(blob, filename);
  }

  /**
   * Get file extension
   */
  private getFileExtension(filename: string): string {
    return filename.toLowerCase().substring(filename.lastIndexOf('.'));
  }

  /**
   * Change file extension
   */
  private changeFileExtension(filename: string, newExtension: string): string {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
      return filename + newExtension;
    }
    return filename.substring(0, lastDotIndex) + newExtension;
  }
}

// Export singleton instance
export const cadEngineClient = new CADEngineClient();