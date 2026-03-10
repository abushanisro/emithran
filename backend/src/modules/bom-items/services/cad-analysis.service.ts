import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { FileStorageService } from './file-storage.service';
import axios from 'axios';

export interface CADAnalysisRequest {
  bomItemId: string;
  filePath: string;
  strategy?: 'aggressive' | 'balanced' | 'conservative';
  forceReanalysis?: boolean;
  userId: string;
  accessToken: string;
}

export interface CADAnalysisResult {
  success: boolean;
  analysisId: string;
  geometryFeatures: any;
  dfmAnalysis: any;
  memoryOptimization: any;
  performanceMetrics: any;
  recommendations: string[];
  processingTimeMs: number;
}

interface GeometryAnalysisResponse {
  success: boolean;
  analysis_id: string;
  original_filename: string;
  optimization_strategy: string;
  model_version: string;
  timestamp: string;
  geometry_features: any;
  memory_optimization: any;
  dfm_analysis: any;
  performance_metrics: any;
}

@Injectable()
export class CADAnalysisService {
  private readonly logger = new Logger(CADAnalysisService.name);
  private readonly cadEngineUrl: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly fileStorageService: FileStorageService,
  ) {
    // Configure CAD engine URL from environment or use default
    this.cadEngineUrl = process.env.CAD_ENGINE_URL || 'http://localhost:5000';
    this.logger.log(`CAD Analysis Service initialized with engine URL: ${this.cadEngineUrl}`);
  }

  /**
   * Perform comprehensive CAD analysis for a BOM item
   * Integrates with the enhanced CAD engine for geometry analysis and DFM insights
   */
  async analyzeBOMItem(request: CADAnalysisRequest): Promise<CADAnalysisResult> {
    const startTime = Date.now();
    
    try {
      this.logger.log(`Starting CAD analysis for BOM item: ${request.bomItemId}`);

      // Validate BOM item exists
      await this.validateBOMItem(request.bomItemId, request.userId, request.accessToken);

      // Check if analysis already exists and is fresh (unless force reanalysis)
      if (!request.forceReanalysis) {
        const existingAnalysis = await this.getExistingAnalysis(request.bomItemId, request.accessToken);
        if (existingAnalysis && this.isAnalysisValid(existingAnalysis)) {
          this.logger.log(`Using existing analysis for BOM item: ${request.bomItemId}`);
          return this.formatAnalysisResult(existingAnalysis, Date.now() - startTime);
        }
      }

      // Get file URL for CAD engine processing
      const fileUrl = await this.getFileUrl(request.filePath, request.accessToken);
      
      // Download file temporarily for analysis
      const fileBuffer = await this.downloadFile(fileUrl);
      
      // Call CAD engine for analysis
      const analysisResponse = await this.callCADEngine(fileBuffer, request.strategy || 'balanced');
      
      // Store analysis results in database
      await this.storeAnalysisResults(request, analysisResponse);
      
      // Format and return result
      const result = this.formatAnalysisResult(analysisResponse, Date.now() - startTime);
      
      this.logger.log(`CAD analysis completed for BOM item: ${request.bomItemId} in ${result.processingTimeMs}ms`);
      return result;

    } catch (error) {
      this.logger.error(`CAD analysis failed for BOM item ${request.bomItemId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`CAD analysis failed: ${error.message}`);
    }
  }

  /**
   * Get CAD analysis summary for a BOM
   */
  async getBOMAnalysisSummary(bomId: string, accessToken: string): Promise<any> {
    try {
      this.logger.log(`Getting CAD analysis summary for BOM: ${bomId}`);

      const client = this.supabaseService.getClient(accessToken);

      const { data, error } = await client
        .from('manufacturing_insights_summary')
        .select('*')
        .eq('bom_id', bomId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new InternalServerErrorException(`Failed to get BOM analysis summary: ${error.message}`);
      }

      return data || {
        bom_id: bomId,
        total_items: 0,
        analyzed_items: 0,
        avg_manufacturability_score: null,
        easy_items: 0,
        medium_items: 0,
        hard_items: 0,
        very_hard_items: 0,
        most_common_process: null,
        avg_memory_reduction: null,
        avg_processing_time_ms: null,
        latest_analysis: null
      };

    } catch (error) {
      this.logger.error(`Failed to get BOM analysis summary: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to get BOM analysis summary: ${error.message}`);
    }
  }

  /**
   * Get detailed analysis for a specific BOM item
   */
  async getBOMItemAnalysis(bomItemId: string, accessToken: string): Promise<any> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      const { data, error } = await client
        .from('bom_items_with_cad_analysis')
        .select('*')
        .eq('id', bomItemId)
        .maybeSingle();

      if (error) {
        throw new InternalServerErrorException(`Failed to get BOM item analysis: ${error.message}`);
      }

      return data;

    } catch (error) {
      this.logger.error(`Failed to get BOM item analysis: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to get BOM item analysis: ${error.message}`);
    }
  }

  /**
   * Get analysis history for performance monitoring
   */
  async getAnalysisHistory(bomItemId: string, accessToken: string, limit = 10): Promise<any[]> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      const { data, error } = await client
        .from('cad_analysis_history')
        .select(`
          id,
          geometry_hash,
          analysis_version,
          optimization_strategy,
          processing_time_ms,
          memory_reduction_percent,
          cache_hit,
          manufacturability_score,
          difficulty_level,
          warnings_count,
          recommendations_count,
          created_at
        `)
        .eq('bom_item_id', bomItemId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw new InternalServerErrorException(`Failed to get analysis history: ${error.message}`);
      }

      return data || [];

    } catch (error) {
      this.logger.error(`Failed to get analysis history: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to get analysis history: ${error.message}`);
    }
  }

  /**
   * Batch analyze multiple BOM items
   */
  async batchAnalyzeBOMItems(
    requests: Omit<CADAnalysisRequest, 'userId' | 'accessToken'>[],
    userId: string,
    accessToken: string
  ): Promise<CADAnalysisResult[]> {
    try {
      this.logger.log(`Starting batch CAD analysis for ${requests.length} BOM items`);

      const results: CADAnalysisResult[] = [];
      
      // Process in chunks to avoid overwhelming the CAD engine
      const chunkSize = 5;
      for (let i = 0; i < requests.length; i += chunkSize) {
        const chunk = requests.slice(i, i + chunkSize);
        
        // Process chunk in parallel
        const chunkPromises = chunk.map(request => 
          this.analyzeBOMItem({
            ...request,
            userId,
            accessToken
          }).catch(error => {
            this.logger.warn(`Failed to analyze BOM item ${request.bomItemId}: ${error.message}`);
            return null; // Continue with other items
          })
        );
        
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults.filter(result => result !== null));
        
        // Small delay between chunks to prevent rate limiting
        if (i + chunkSize < requests.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      this.logger.log(`Batch CAD analysis completed. Processed ${results.length}/${requests.length} items successfully`);
      return results;

    } catch (error) {
      this.logger.error(`Batch CAD analysis failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Batch CAD analysis failed: ${error.message}`);
    }
  }

  /**
   * Clean up old analysis cache entries
   */
  async cleanupAnalysisCache(accessToken: string): Promise<number> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      const { data, error } = await client.rpc('cleanup_cad_analysis_cache');

      if (error) {
        throw new InternalServerErrorException(`Failed to cleanup analysis cache: ${error.message}`);
      }

      const deletedCount = data || 0;
      this.logger.log(`Cleaned up ${deletedCount} expired cache entries`);
      return deletedCount;

    } catch (error) {
      this.logger.error(`Failed to cleanup analysis cache: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to cleanup analysis cache: ${error.message}`);
    }
  }

  // Private helper methods

  private async validateBOMItem(bomItemId: string, userId: string, accessToken: string): Promise<void> {
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select('id, part_number')
      .eq('id', bomItemId)
      .single();

    if (error || !data) {
      throw new BadRequestException(`BOM item not found: ${bomItemId}`);
    }
  }

  private async getExistingAnalysis(bomItemId: string, accessToken: string): Promise<any> {
    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('bom_items')
      .select(`
        analysis_timestamp,
        geometry_analysis,
        dfm_analysis,
        memory_optimization_metrics,
        manufacturability_score,
        difficulty_level,
        recommended_processes,
        analysis_version
      `)
      .eq('id', bomItemId)
      .single();

    if (error || !data?.analysis_timestamp) {
      return null;
    }

    return data;
  }

  private isAnalysisValid(analysis: any): boolean {
    if (!analysis.analysis_timestamp) return false;
    
    const analysisDate = new Date(analysis.analysis_timestamp);
    const now = new Date();
    const daysSinceAnalysis = (now.getTime() - analysisDate.getTime()) / (1000 * 60 * 60 * 24);
    
    // Consider analysis valid for 7 days
    return daysSinceAnalysis < 7;
  }

  private async getFileUrl(filePath: string, accessToken: string): Promise<string> {
    const signedUrl = await this.fileStorageService.getSignedUrl(filePath, 3600);
    return signedUrl;
  }

  private async downloadFile(fileUrl: string): Promise<Buffer> {
    try {
      const response = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 500 * 1024 * 1024, // 500MB max
      });
      
      return Buffer.from(response.data);
    } catch (error) {
      throw new InternalServerErrorException(`Failed to download file for analysis: ${error.message}`);
    }
  }

  private async callCADEngine(fileBuffer: Buffer, strategy: string): Promise<GeometryAnalysisResponse> {
    try {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(fileBuffer)], { type: 'application/octet-stream' });
      formData.append('file', blob, 'model.step');
      formData.append('strategy', strategy);
      formData.append('force_reanalysis', 'false');

      const response = await axios.post(
        `${this.cadEngineUrl}/analyze/geometry`,
        formData,
        {
          timeout: 300000, // 5 minutes
          maxContentLength: 100 * 1024 * 1024, // 100MB response limit
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      if (!response.data.success) {
        throw new Error('CAD engine analysis failed');
      }

      return response.data;

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new InternalServerErrorException('CAD engine is not available. Please ensure the CAD engine service is running.');
      }
      
      // Log detailed error information for debugging
      if (error.response) {
        this.logger.error(`CAD engine responded with ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        throw new InternalServerErrorException(`CAD engine analysis failed: Status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
      } else {
        this.logger.error(`CAD engine request failed: ${error.message}`, error.stack);
        throw new InternalServerErrorException(`CAD engine analysis failed: ${error.message}`);
      }
    }
  }

  private async storeAnalysisResults(request: CADAnalysisRequest, analysisResponse: GeometryAnalysisResponse): Promise<void> {
    const client = this.supabaseService.getClient(request.accessToken);

    try {
      // Use the stored procedure for atomic updates
      const { error } = await client.rpc('update_bom_item_cad_analysis', {
        p_bom_item_id: request.bomItemId,
        p_geometry_analysis: analysisResponse.geometry_features,
        p_dfm_analysis: analysisResponse.dfm_analysis,
        p_memory_metrics: analysisResponse.memory_optimization,
        p_geometry_hash: analysisResponse.analysis_id,
        p_analysis_version: analysisResponse.model_version,
        p_optimization_strategy: request.strategy || 'balanced',
        p_user_id: request.userId
      });

      if (error) {
        throw new Error(`Failed to store analysis results: ${error.message}`);
      }

      this.logger.log(`Analysis results stored successfully for BOM item: ${request.bomItemId}`);

    } catch (error) {
      this.logger.error(`Failed to store analysis results: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to store analysis results: ${error.message}`);
    }
  }

  private formatAnalysisResult(analysisResponse: any, processingTimeMs: number): CADAnalysisResult {
    return {
      success: true,
      analysisId: analysisResponse.analysis_id || analysisResponse.geometry_hash || 'unknown',
      geometryFeatures: analysisResponse.geometry_features || analysisResponse.geometry_analysis,
      dfmAnalysis: analysisResponse.dfm_analysis,
      memoryOptimization: analysisResponse.memory_optimization || analysisResponse.memory_optimization_metrics,
      performanceMetrics: analysisResponse.performance_metrics || {
        lod_levels_generated: analysisResponse.lod_levels_available || 0
      },
      recommendations: analysisResponse.performance_metrics?.recommendations || [],
      processingTimeMs
    };
  }
}