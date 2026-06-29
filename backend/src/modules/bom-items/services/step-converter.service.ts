import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import FormData from 'form-data';

/**
 * STEP to STL Converter Service
 *
 * Professional Production Implementation:
 * - Uses dedicated Python + OpenCascade CAD engine microservice
 * - Industry-standard conversion (same tech as FreeCAD, CATIA, Salome)
 * - ISO 10303 (STEP) compliant
 * - High-quality mesh generation
 *
 * Architecture:
 * NestJS Backend → Python CAD Engine → OpenCascade OCCT
 */
@Injectable()
export class StepConverterService {
  private readonly logger = new Logger(StepConverterService.name);
  private readonly cadEngineUrl: string;
  private readonly cadEngineApiKey: string;
  private cadEngineAvailable: boolean | null = null;
  private cadEngineLastChecked: number = 0;
  private readonly AVAILABILITY_CACHE_TTL = 60000;

  constructor(private configService: ConfigService) {
    this.cadEngineUrl = this.configService.get<string>('CAD_ENGINE_URL', 'http://localhost:5000');
    this.cadEngineApiKey = this.configService.get<string>('CAD_ENGINE_API_KEY', '');
    this.logger.log(`CAD Engine configured at: ${this.cadEngineUrl}`);
  }

  /**
   * Check if CAD engine is available
   */
  private async checkCadEngineAvailability(): Promise<boolean> {
    // Cache the availability check with TTL
    const now = Date.now();
    if (this.cadEngineAvailable !== null && (now - this.cadEngineLastChecked) < this.AVAILABILITY_CACHE_TTL) {
      return this.cadEngineAvailable;
    }

    this.cadEngineLastChecked = now;

    try {
      const response = await axios.get(`${this.cadEngineUrl}/health`, {
        timeout: 5000,
      });

      this.cadEngineAvailable = response.data.status === 'healthy';

      if (this.cadEngineAvailable) {
        this.logger.log(
          `CAD Engine available - OpenCascade ${response.data.opencascade}`,
        );
      } else {
        this.logger.warn('CAD Engine responded but not healthy');
      }

      return this.cadEngineAvailable;
    } catch (error) {
      this.cadEngineAvailable = false;
      this.logger.warn(
        `CAD Engine not available at ${this.cadEngineUrl} - STEP files will be download-only`,
      );
      return false;
    }
  }

  /**
   * Convert STEP file to STL using Python CAD Engine
   *
   * @param stepFileBuffer - STEP file content
   * @param originalFilename - Original filename (for logging)
   * @returns STL file buffer
   * @throws Error if conversion fails
   */
  async convertStepToStl(
    stepFileBuffer: Buffer,
    originalFilename?: string,
  ): Promise<Buffer> {
    const canConvert = await this.checkCadEngineAvailability();

    if (!canConvert) {
      throw new Error(
        `CAD Engine not available at ${this.cadEngineUrl}. Make sure the service is running.`,
      );
    }

    try {
      // Create form data with STEP file
      const formData = new FormData();
      formData.append('file', stepFileBuffer, {
        filename: originalFilename || 'model.step',
        contentType: 'application/octet-stream',
      });

      this.logger.log(`Converting STEP file: ${originalFilename || 'model.step'}`);

      // Send to CAD engine for conversion
      const response = await axios.post(
        `${this.cadEngineUrl}/convert/step-to-stl`,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }),
          },
          responseType: 'arraybuffer',
          timeout: 60000,
          maxContentLength: 100 * 1024 * 1024,
          maxBodyLength: 100 * 1024 * 1024,
        },
      );

      const stlBuffer = Buffer.from(response.data);
      const stlSizeMB = (stlBuffer.length / 1024 / 1024).toFixed(2);

      this.logger.log(
        `Successfully converted STEP to STL (${stlSizeMB} MB)`,
      );

      return stlBuffer;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `STEP to STL conversion failed: ${err.message}`,
        err.stack,
      );

      // Provide detailed error message
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          this.cadEngineAvailable = false;
          this.cadEngineLastChecked = Date.now();
          throw new Error(
            `CAD Engine connection refused at ${this.cadEngineUrl}. Make sure the service is running.`,
          );
        } else if (error.response) {
          let errorMsg = error.response.statusText;
          try {
            // Parse buffer to JSON for error responses
            const errorData = JSON.parse(error.response.data.toString());
            errorMsg = errorData.error || errorMsg;
          } catch {
            // If parsing fails, use statusText
          }
          throw new Error(
            `CAD Engine conversion failed (${error.response.status}): ${errorMsg}`,
          );
        }
      }

      throw new Error(`STEP conversion failed: ${err.message}`);
    }
  }

  /**
   * Check if a file is a STEP file based on extension
   */
  isStepFile(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop();
    return ['step', 'stp', 'iges', 'igs', 'sldprt'].includes(ext || '');
  }

  /**
   * Get supported CAD file extensions
   */
  getSupportedExtensions(): string[] {
    return ['step', 'stp', 'iges', 'igs', 'sldprt'];
  }

  /**
   * Reset availability check (useful for testing/debugging)
   */
  resetAvailabilityCheck(): void {
    this.cadEngineAvailable = null;
  }
}
