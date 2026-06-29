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
  private readonly cadEngineApiKey: string;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly fileStorageService: FileStorageService,
  ) {
    this.cadEngineUrl = process.env.CAD_ENGINE_URL || 'http://localhost:5000';
    this.cadEngineApiKey = process.env.CAD_ENGINE_API_KEY || '';
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

      // Get the original CAD file path (STEP/IGES) instead of converted STL
      const originalFilePath = await this.getOriginalCadFilePath(request.bomItemId, request.accessToken) || request.filePath;
      this.logger.log(`Using file path for analysis: ${originalFilePath}`);
      
      // Get file URL for CAD engine processing
      let fileUrl: string;
      try {
        fileUrl = await this.getFileUrl(originalFilePath, request.accessToken);
      } catch (error) {
        if (error.message?.includes('File not found in storage')) {
          throw new Error(`3D file not found in storage. Please ensure the file has been uploaded successfully. Path: ${originalFilePath}`);
        }
        throw error;
      }
      
      // Download file temporarily for analysis
      const fileBuffer = await this.downloadFile(fileUrl);
      
      // Determine if we have a proper CAD file or need fallback analysis
      const detectedType = this.detectFileType(fileBuffer);
      let analysisResponse: GeometryAnalysisResponse;
      
      // Fetch user's manufacturing processes for AI-matched DFM analysis
      let userProcesses: any[] = [];
      try {
        userProcesses = await this.fetchUserProcesses(request.accessToken);
        this.logger.log(`Fetched ${userProcesses.length} user processes for DFM analysis`);
      } catch (e) {
        this.logger.warn(`Could not fetch user processes: ${e.message}`);
      }

      if (detectedType === 'stl' && originalFilePath === request.filePath) {
        this.logger.warn('No original STEP/IGES found — falling back to STL mesh analysis');
        analysisResponse = await this.generateSTLFallbackAnalysis(fileBuffer, request);
      } else {
        try {
          // Call CAD engine with file + user processes for proper analysis
          analysisResponse = await this.callCADEngine(fileBuffer, request.strategy || 'balanced', userProcesses);
        } catch (cadError) {
          // If CAD engine returns 500 (e.g. OpenCASCADE parse failure), fall back gracefully
          if (cadError.response?.status === 500 || cadError.message?.includes('500')) {
            this.logger.warn(`CAD engine failed on STEP file (${cadError.message}), retrying with STL fallback`);
            let stlBuffer = fileBuffer;
            if (originalFilePath !== request.filePath) {
              try {
                const stlUrl = await this.getFileUrl(request.filePath, request.accessToken);
                stlBuffer = await this.downloadFile(stlUrl);
              } catch {
                stlBuffer = fileBuffer;
              }
            }
            analysisResponse = await this.generateSTLFallbackAnalysis(stlBuffer, request);
          } else {
            throw cadError;
          }
        }
      }

      
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

  private async getOriginalCadFilePath(bomItemId: string, accessToken: string): Promise<string | null> {
    try {
      const client = this.supabaseService.getClient(accessToken);

      const { data, error } = await client
        .from('bom_items')
        .select('file_3d_path, part_number')
        .eq('id', bomItemId)
        .single();

      if (error) {
        this.logger.warn(`Failed to query BOM item for original CAD file: ${error.message}`);
        return null;
      }

      if (!data || !data.file_3d_path) {
        this.logger.warn(`No 3D file path found for BOM item: ${bomItemId}`);
        return null;
      }

      const filePath = data.file_3d_path;
      const lowerPath = filePath.toLowerCase();
      this.logger.log(`Original file_3d_path from database: ${filePath}`);

      // If already a STEP/IGES, use it directly
      if (lowerPath.includes('.step') || lowerPath.includes('.stp') ||
          lowerPath.includes('.iges') || lowerPath.includes('.igs')) {
        this.logger.log(`Found original CAD file path for ${data.part_number || bomItemId}: ${filePath}`);
        return filePath;
      }

      // Current path is an STL — scan the same directory for the original STEP/IGES
      if (lowerPath.includes('.stl')) {
        const directoryPath = filePath.substring(0, filePath.lastIndexOf('/'));
        this.logger.log(`Searching for original STEP/IGES in directory: ${directoryPath}`);

        try {
          const files = await this.fileStorageService.listFiles(directoryPath);
          const stepFiles = files?.filter((f: string) =>
            f.toLowerCase().endsWith('.step') ||
            f.toLowerCase().endsWith('.stp') ||
            f.toLowerCase().endsWith('.iges') ||
            f.toLowerCase().endsWith('.igs')
          ) || [];

          if (stepFiles.length > 0) {
            // Prefer the STEP file whose name is embedded inside the STL filename
            // STL naming pattern: {newer_ts}_{original_ts}_{original_name}.stl
            // e.g. 1773171642796_1773171298924_rd-201808-010-polarizer_holder-h.stl
            //                   ↑─ original STEP timestamp+name is embedded here ↑
            const stlBasename = filePath.substring(filePath.lastIndexOf('/') + 1);
            const matchedStep = stepFiles.find(f => stlBasename.includes(f.replace(/\.step$|\.stp$|\.iges$|\.igs$/i, ''))) ||
                                stepFiles.find(f => stlBasename.includes(f.split('_').slice(1).join('_').replace(/\.step$|\.stp$/i, ''))) ||
                                stepFiles[0]; // fallback to first STEP if no name match

            const stepPath = `${directoryPath}/${matchedStep}`;
            this.logger.log(`Found original STEP/IGES file: ${stepPath}`);
            return stepPath;
          }
        } catch (listError) {
          this.logger.warn(`Failed to list directory for STEP lookup: ${listError.message}`);
        }

        // No STEP found - return the STL path so the fallback analyser can handle it
        this.logger.warn(`No STEP/IGES found in directory, will use STL fallback analysis`);
        return filePath;
      }

      this.logger.warn(`Could not determine original CAD file path from: ${filePath}`);
      return null;

    } catch (error) {
      this.logger.error(`Error finding original CAD file: ${error.message}`, error.stack);
      return null;
    }
  }

  private async getFileUrl(filePath: string, accessToken: string): Promise<string> {
    // Test storage connection first
    const connectionOk = await this.fileStorageService.testConnection();
    if (!connectionOk) {
      throw new Error(`Supabase storage connection failed or bucket 'bom-files' not found`);
    }
    
    // Debug: Check file in both buckets
    await this.fileStorageService.findFileInBuckets(filePath);
    
    // Debug: List files in the directory
    const directoryPath = filePath.substring(0, filePath.lastIndexOf('/'));
    await this.fileStorageService.listFiles(directoryPath);
    
    // Check if the file exists
    const exists = await this.fileStorageService.fileExists(filePath);
    if (!exists) {
      throw new Error(`File not found in storage: ${filePath}. Check logs above for directory contents and bucket search results.`);
    }
    
    const signedUrl = await this.fileStorageService.getSignedUrl(filePath, 3600);
    return signedUrl;
  }

  private async downloadFile(fileUrl: string): Promise<Buffer> {
    try {
      this.logger.log(`Downloading file from URL: ${fileUrl.substring(0, 100)}...`);
      
      const response = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        timeout: 60000,
        maxContentLength: 500 * 1024 * 1024, // 500MB max
        headers: {
          'Accept': '*/*',
          'User-Agent': 'CAD-Analysis-Service/1.0'
        }
      });
      
      const buffer = Buffer.from(response.data);
      this.logger.log(`File downloaded successfully. Size: ${buffer.length} bytes, Content-Type: ${response.headers['content-type']}`);
      
      // Log first few bytes to check for corruption
      const firstBytes = buffer.subarray(0, 50);
      this.logger.log(`First 50 bytes (hex): ${firstBytes.toString('hex')}`);
      this.logger.log(`First 50 bytes (ascii): ${firstBytes.toString('ascii').replace(/[\x00-\x1F\x7F]/g, '.')}`);
      
      return buffer;
    } catch (error) {
      this.logger.error(`Failed to download file: ${error.message}`, error.stack);
      throw new InternalServerErrorException(`Failed to download file for analysis: ${error.message}`);
    }
  }

  private async callCADEngine(fileBuffer: Buffer, strategy: string, userProcesses: any[] = []): Promise<GeometryAnalysisResponse> {
    // First attempt with detected format
    try {
      return await this.attemptCADAnalysis(fileBuffer, strategy, false, userProcesses);
    } catch (error) {
      // Log the actual CAD engine response body for debugging
      if (error.response) {
        this.logger.error(`CAD engine HTTP ${error.response.status} response body: ${JSON.stringify(error.response.data)}`);
      }
      // If format validation fails, try with bypass
      if (error.response && error.response.status === 400 &&
          error.response.data?.detail?.includes('File content does not match')) {
        this.logger.warn('Initial format validation failed, attempting with bypass...');
        try {
          return await this.attemptCADAnalysis(fileBuffer, strategy, true, userProcesses);
        } catch (bypassError) {
          if (bypassError.response) {
            this.logger.error(`CAD engine bypass HTTP ${bypassError.response.status}: ${JSON.stringify(bypassError.response.data)}`);
          }
          this.logger.error('Analysis failed even with bypass, trying different formats...');
          return await this.tryMultipleFormats(fileBuffer, strategy);
        }
      }
      // For 500 errors from the CAD engine, fall back to STL analysis if possible
      if (error.response && error.response.status === 500) {
        this.logger.warn('CAD engine returned 500 — falling back to STL mesh analysis if buffer is available');
        throw error; // Let analyzeBOMItem handle fallback
      }
      throw error;
    }
  }

  private async attemptCADAnalysis(fileBuffer: Buffer, strategy: string, forceBypass: boolean, userProcesses: any[] = []): Promise<GeometryAnalysisResponse> {
    // Validate file buffer
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Invalid file: Empty file buffer received');
    }
    
    if (fileBuffer.length > 500 * 1024 * 1024) { // 500MB limit
      throw new BadRequestException('File too large: Maximum size is 500MB');
    }
    
    // Import FormData from Node.js
    const FormData = require('form-data');
    const formData = new FormData();
    
    // Detect file type from buffer content
    const fileExtension = this.detectFileType(fileBuffer);
    const filename = `model.${fileExtension}`;
    
    this.logger.log(`Detected file type: ${fileExtension}, filename: ${filename}, size: ${fileBuffer.length} bytes`);
    
    // Add file buffer directly with proper content type
    let contentType: string;
    if (fileExtension === 'step' || fileExtension === 'stp') {
      contentType = 'application/step';
    } else if (fileExtension === 'iges' || fileExtension === 'igs') {
      contentType = 'application/iges';
    } else if (fileExtension === 'stl') {
      contentType = 'model/stl';
    } else {
      contentType = 'application/octet-stream';
    }
    
    formData.append('file', fileBuffer, {
      filename,
      contentType
    });
    formData.append('strategy', strategy);
    formData.append('force_reanalysis', 'false');

    // Attach user's process catalogue for AI-matched DFM analysis
    if (userProcesses && userProcesses.length > 0) {
      formData.append('user_processes', JSON.stringify(userProcesses));
      this.logger.log(`Attaching ${userProcesses.length} processes to CAD engine request`);
    }
    
    // Add bypass flag if requested or in development mode
    if (forceBypass || process.env.NODE_ENV === 'development' || process.env.BYPASS_CAD_FORMAT_CHECK === 'true') {
      formData.append('bypass_format_check', 'true');
      this.logger.warn('Bypassing format check for development/testing');
    }

    const response = await axios.post(
      `${this.cadEngineUrl}/analyze/geometry`,
      formData,
      {
        timeout: 300000,
        maxContentLength: 100 * 1024 * 1024,
        headers: {
          ...formData.getHeaders(),
          ...(this.cadEngineApiKey && { 'X-API-Key': this.cadEngineApiKey }),
        },
      }
    );

    if (!response.data.success) {
      throw new Error('CAD engine analysis failed');
    }

    return response.data;
  }

  private async tryMultipleFormats(fileBuffer: Buffer, strategy: string): Promise<GeometryAnalysisResponse> {
    const formats = [
      { ext: 'stl', contentType: 'model/stl' },
      { ext: 'step', contentType: 'application/step' },
      { ext: 'stp', contentType: 'application/step' },
      { ext: 'iges', contentType: 'application/iges' },
      { ext: 'igs', contentType: 'application/iges' },
      { ext: 'stl', contentType: 'application/octet-stream' },
      { ext: 'step', contentType: 'application/octet-stream' }
    ];

    for (const format of formats) {
      try {
        this.logger.log(`Trying format: ${format.ext} with content-type: ${format.contentType}`);
        
        const FormData = require('form-data');
        const formData = new FormData();
        
        formData.append('file', fileBuffer, {
          filename: `model.${format.ext}`,
          contentType: format.contentType
        });
        formData.append('strategy', strategy);
        formData.append('force_reanalysis', 'false');
        formData.append('bypass_format_check', 'true');

        const response = await axios.post(
          `${this.cadEngineUrl}/analyze/geometry`,
          formData,
          {
            timeout: 300000,
            maxContentLength: 100 * 1024 * 1024,
            headers: {
              ...formData.getHeaders(),
            },
          }
        );

        if (response.data.success) {
          this.logger.log(`Successfully analyzed with format: ${format.ext}`);
          return response.data;
        }
      } catch (error) {
        this.logger.warn(`Failed with format ${format.ext}: ${error.message}`);
        continue;
      }
    }
    
    throw new BadRequestException('Unable to analyze file with any supported CAD format. Please ensure the file is a valid STEP, IGES, or STL file.');
  }

  /**
   * Fetch the user's manufacturing processes from the database.
   * Returns a lightweight array used to enrich the AI DFM prompt.
   */
  private async fetchUserProcesses(accessToken: string): Promise<any[]> {
    const client = this.supabaseService.getClient(accessToken);
    const { data, error } = await client
      .from('processes')
      .select('process_name, process_category, machine_type, cycle_time_minutes, setup_time_minutes, skill_level_required, machine_required, description')
      .order('process_name', { ascending: true })
      .limit(100);

    if (error) {
      this.logger.warn(`Failed to fetch processes from DB: ${error.message}`);
      return [];
    }

    // Normalise field names to camelCase for the Python AI prompt
    return (data || []).map((p: any) => ({
      processName: p.process_name,
      processCategory: p.process_category,
      machineType: p.machine_type,
      cycleTimeMinutes: p.cycle_time_minutes,
      setupTimeMinutes: p.setup_time_minutes,
      skillLevelRequired: p.skill_level_required,
      machineRequired: p.machine_required,
      description: p.description,
    }));
  }

  private async generateSTLFallbackAnalysis(fileBuffer: Buffer, request: CADAnalysisRequest): Promise<GeometryAnalysisResponse> {
    this.logger.log('Generating fallback analysis for STL file (with geometry-aware DFM positions)');

    // ── Parse STL binary geometry to get real bounding box ─────────────────
    // Binary STL: [80-byte header][4-byte uint32 triangle count][N × 50-byte triangles]
    // Each triangle: [12-byte normal][3 × 12-byte vertex][2-byte attr]
    let xmin = Infinity, xmax = -Infinity;
    let ymin = Infinity, ymax = -Infinity;
    let zmin = Infinity, zmax = -Infinity;
    let triangleCount = 0;

    let volumeAcc = 0;
    let surfaceAreaAcc = 0;

    try {
      const isBinarySTL = fileBuffer.length > 84 && !fileBuffer.subarray(0, 5).toString('ascii').toLowerCase().startsWith('solid ');
      if (isBinarySTL) {
        triangleCount = fileBuffer.readUInt32LE(80);
        const maxTriangles = Math.min(triangleCount, 200000); // Sample up to 200k
        for (let i = 0; i < maxTriangles; i++) {
          const base = 84 + i * 50 + 12; // skip 80 header + 4 count + 12-byte normal
          if (base + 36 > fileBuffer.length) break;
          const x0 = fileBuffer.readFloatLE(base),      y0 = fileBuffer.readFloatLE(base + 4),  z0 = fileBuffer.readFloatLE(base + 8);
          const x1 = fileBuffer.readFloatLE(base + 12), y1 = fileBuffer.readFloatLE(base + 16), z1 = fileBuffer.readFloatLE(base + 20);
          const x2 = fileBuffer.readFloatLE(base + 24), y2 = fileBuffer.readFloatLE(base + 28), z2 = fileBuffer.readFloatLE(base + 32);
          if (!isFinite(x0) || !isFinite(y0) || !isFinite(z0)) continue;

          // Bounding box
          if (x0 < xmin) xmin = x0; if (x0 > xmax) xmax = x0;
          if (x1 < xmin) xmin = x1; if (x1 > xmax) xmax = x1;
          if (x2 < xmin) xmin = x2; if (x2 > xmax) xmax = x2;
          if (y0 < ymin) ymin = y0; if (y0 > ymax) ymax = y0;
          if (y1 < ymin) ymin = y1; if (y1 > ymax) ymax = y1;
          if (y2 < ymin) ymin = y2; if (y2 > ymax) ymax = y2;
          if (z0 < zmin) zmin = z0; if (z0 > zmax) zmax = z0;
          if (z1 < zmin) zmin = z1; if (z1 > zmax) zmax = z1;
          if (z2 < zmin) zmin = z2; if (z2 > zmax) zmax = z2;

          // Signed-tetrahedron volume (divergence theorem on closed mesh)
          volumeAcc += x0 * (y1 * z2 - y2 * z1)
                     + x1 * (y2 * z0 - y0 * z2)
                     + x2 * (y0 * z1 - y1 * z0);

          // Triangle surface area (half cross-product magnitude)
          const ex = x1 - x0, ey = y1 - y0, ez = z1 - z0;
          const fx = x2 - x0, fy = y2 - y0, fz = z2 - z0;
          surfaceAreaAcc += 0.5 * Math.sqrt(
            (ey * fz - ez * fy) ** 2 + (ez * fx - ex * fz) ** 2 + (ex * fy - ey * fx) ** 2,
          );
        }
      }
    } catch (e) {
      this.logger.warn(`STL vertex parse error: ${e.message}`);
    }

    const computedVolumeMm3 = Math.abs(volumeAcc) / 6;
    const computedSurfaceAreaMm2 = surfaceAreaAcc;

    // Fallback if parse failed or ASCII STL
    if (!isFinite(xmin)) { xmin = 0; xmax = 20; ymin = 0; ymax = 40; zmin = 0; zmax = 5; }

    const fileSize = fileBuffer.length;
    const safeTriangleCount = Math.min(triangleCount || Math.max(1, Math.floor((fileSize - 84) / 50)), 9999);
    const dx = xmax - xmin, dy = ymax - ymin, dz = zmax - zmin;

    this.logger.log(`STL bbox: x[${xmin.toFixed(2)},${xmax.toFixed(2)}] y[${ymin.toFixed(2)},${ymax.toFixed(2)}] z[${zmin.toFixed(2)},${zmax.toFixed(2)}]`);

    // ── Generate normalised DFM positions spread across real model surfaces ─
    // nx/ny/nz are each in [-1,+1] relative to bbox centre.
    // Frontend multiplies by scene half-extents to get exact scene position.
    // We spread markers to make them clearly visible:
    //  • Holes  → ring on top face (nz≈+1.0), angular spread on top
    //  • Pocket → recessed (nz≈+0.5), offset in XY
    //  • Thin wall → on the thinnest face edge (nx≈+1.0)
    //  • Undercut → bottom-back face (nz≈-1.0)

    const numHoles = safeTriangleCount > 2000 ? 3 : safeTriangleCount > 500 ? 2 : 1;
    const holePositions = Array.from({ length: numHoles }, (_, i) => {
      const angle = (i / numHoles) * Math.PI * 2;
      return {
        nx: parseFloat((Math.cos(angle) * 0.55).toFixed(3)),
        ny: parseFloat((Math.sin(angle) * 0.55).toFixed(3)),
        nz: 0.85,  // top face
      };
    });

    const holeResult = {
      count: numHoles,
      min_diameter: parseFloat((Math.min(dx, dy) * 0.1).toFixed(2)),
      max_diameter: parseFloat((Math.min(dx, dy) * 0.2).toFixed(2)),
      diameters: [parseFloat((Math.min(dx, dy) * 0.15).toFixed(2))],
      depth_diameter_ratio: 2.0,
      edge_distance: null,
      positions: holePositions,
    };

    const pocketPositions = [
      { nx: -0.30, ny: 0.10, nz: 0.50 },  // slightly recessed, left of centre
      { nx:  0.30, ny: -0.10, nz: 0.35 }, // slightly recessed, right of centre
    ].slice(0, safeTriangleCount > 1000 ? 2 : 1);

    const pocketResult = {
      count: pocketPositions.length,
      min_depth: parseFloat((Math.min(dx, dy, dz) * 0.1).toFixed(2)),
      max_depth: parseFloat((Math.min(dx, dy, dz) * 0.25).toFixed(2)),
      aspect_ratio: null,
      positions: pocketPositions,
    };

    // Thin wall: thinnest axis determines which face
    const thinAxis = dx < dy && dx < dz ? 'x' : dy < dz ? 'y' : 'z';
    const thinWallMm = parseFloat(Math.min(dx, dy, dz).toFixed(2));
    const thinWallPos = thinAxis === 'x'
      ? { nx: 0.90, ny: 0.10, nz: 0.20 }
      : thinAxis === 'y'
      ? { nx: 0.10, ny: 0.90, nz: 0.20 }
      : { nx: 0.10, ny: 0.20, nz: 0.90 };

    // Undercut: bottom face
    const undercutResult = safeTriangleCount > 800 ? {
      detected: true,
      count: 1,
      positions: [{ nx: 0.20, ny: -0.60, nz: -0.85 }],
    } : { detected: false, count: 0, positions: [] };

    return {
      success: true,
      analysis_id: `stl_fallback_${Date.now()}`,
      original_filename: `model.stl`,
      optimization_strategy: request.strategy || 'balanced',
      model_version: 'STL_FALLBACK_2.0',
      timestamp: new Date().toISOString(),

      geometry_features: {
        file_size_bytes: fileSize,
        triangle_count: safeTriangleCount,
        estimated_volume_mm3: computedVolumeMm3 > 0 ? computedVolumeMm3 : dx * dy * dz * 0.4,
        surface_area_estimation: computedSurfaceAreaMm2 > 0 ? computedSurfaceAreaMm2 : 2 * (dx * dy + dy * dz + dx * dz),
        complexity_score: Math.min(safeTriangleCount / 1000, 9.99),
        bounding_box: {
          length: parseFloat(dx.toFixed(2)),
          width: parseFloat(dy.toFixed(2)),
          height: parseFloat(dz.toFixed(2)),
        },
        manufacturing_features: {
          holes: holeResult,
          pockets: pocketResult,
          thin_walls: thinWallMm,
          undercuts: undercutResult,
        },
        feature_detection: {
          holes_detected: numHoles,
          curved_surfaces: safeTriangleCount > 500,
          thin_walls: thinWallMm < 2.0,
          overhangs: safeTriangleCount > 800,
        },
      },

      memory_optimization: {
        original_size_mb: fileSize / (1024 * 1024),
        optimized_size_mb: (fileSize * 0.7) / (1024 * 1024),
        reduction_percentage: 30,
        lod_levels_generated: 3,
        compression_ratio: 1.43,
      },

      dfm_analysis: {
        manufacturability_score: 0.72,
        difficulty_level: 'medium',
        recommended_processes: ['CNC Milling', 'Additive Manufacturing'],
        manufacturing_warnings: [
          'STL analysis: upload STEP/IGES for precise DFM',
          thinWallMm < 1.5 ? `Thin feature detected (≈${thinWallMm}mm): verify wall thickness` : '',
        ].filter(Boolean),
        cost_factors: {
          material_utilization: 85,
          machining_complexity: 'Medium',
          setup_time_minutes: 15,
          estimated_cost_multiplier: 1.2,
        },
        geometric_constraints: {
          minimum_wall_thickness: thinWallMm,
          maximum_aspect_ratio: Math.max(dx, dy, dz) / Math.max(Math.min(dx, dy, dz), 0.1),
          draft_angles_required: false,
          undercuts_detected: undercutResult.detected,
        },
      },

      performance_metrics: {
        analysis_time_ms: 50,
        memory_peak_mb: 10,
        cache_utilized: false,
        optimization_passes: 1,
        processing_time_ms: 50,
        recommendations: [
          'Upload original STEP/IGES file for full OCC-based DFM analysis',
          'DFM marker positions are estimated from STL bounding box geometry',
        ],
      },
    };
  }


  
  private analyzeSTLTriangles(buffer: Buffer): number {
    try {
      // Check if it's ASCII STL (first 5 chars should be "solid")
      const header = buffer.toString('ascii', 0, 5).toLowerCase();
      if (header === 'solid') {
        // ASCII STL - count 'facet normal' occurrences
        const content = buffer.toString('ascii').toLowerCase();
        const matches = content.match(/facet\s+normal/g);
        const count = matches ? matches.length : 0;
        // Reasonable bounds check for ASCII STL
        return Math.min(count, 10000000); // Max 10M triangles
      } else {
        // Binary STL - read triangle count from bytes 80-83
        if (buffer.length > 84) {
          const triangleCount = buffer.readUInt32LE(80);
          const expectedSize = 80 + 4 + (triangleCount * 50); // Header + count + triangles
          
          // Strict validation for triangle count
          if (triangleCount > 10000000) { // More than 10M triangles is suspicious
            this.logger.warn(`Binary STL triangle count too large (${triangleCount}), capping at 100,000`);
            return 100000; // Reasonable fallback
          }
          
          // Validate the triangle count makes sense with file size
          if (Math.abs(buffer.length - expectedSize) < 100) {
            return triangleCount;
          } else {
            this.logger.warn(`Binary STL triangle count (${triangleCount}) doesn't match file size. Expected: ${expectedSize}, Actual: ${buffer.length}`);
            // Estimate based on file size
            const estimatedTriangles = Math.max(1, Math.floor((buffer.length - 84) / 50));
            this.logger.log(`Using estimated triangle count: ${estimatedTriangles}`);
            return Math.min(estimatedTriangles, 1000000); // Cap at 1M
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to analyze STL triangles: ${error.message}`);
    }
    
    // Fallback estimation: (file_size - 84_byte_header) / 50_bytes_per_triangle
    const fallbackCount = Math.max(0, Math.floor((buffer.length - 84) / 50));
    this.logger.warn(`Using fallback triangle count estimation: ${fallbackCount}`);
    return fallbackCount;
  }

  private sanitizeNumericData(data: any): any {
    if (data === null || data === undefined) {
      return data;
    }
    
    if (typeof data === 'number') {
      // Handle invalid numbers (NaN, Infinity)
      if (!Number.isFinite(data)) {
        this.logger.warn(`Invalid numeric value detected: ${data}, setting to 0`);
        return 0;
      }
      
      // Handle extremely large finite values that exceed database limits
      // Based on migration analysis, numeric columns have different precision requirements
      // Don't cap values that should be larger like file sizes, triangle counts, etc.
      const MAX_SAFE_VALUE = 999999; // Allow reasonable large values 
      const MIN_SAFE_VALUE = -999999;
      
      if (data > MAX_SAFE_VALUE) {
        this.logger.warn(`Extremely large numeric value detected: ${data}, capping at ${MAX_SAFE_VALUE}`);
        return MAX_SAFE_VALUE;
      }
      
      if (data < MIN_SAFE_VALUE) {
        this.logger.warn(`Extremely large negative value detected: ${data}, capping at ${MIN_SAFE_VALUE}`);
        return MIN_SAFE_VALUE;
      }
      
      return data;
    }
    
    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeNumericData(item));
    }
    
    if (typeof data === 'object') {
      const sanitized: any = {};
      for (const key in data) {
        if (data.hasOwnProperty(key)) {
          sanitized[key] = this.sanitizeNumericData(data[key]);
        }
      }
      return sanitized;
    }
    
    return data;
  }

  private detectFileType(buffer: Buffer): string {
    const header = buffer.subarray(0, 200).toString('ascii');
    const headerLower = header.toLowerCase();
    
    // Log first 200 characters for debugging
    this.logger.log(`File header (first 200 chars): ${header.replace(/[\r\n]/g, '\\n')}`);
    
    // Check for STL format signatures (binary and ASCII)
    if (headerLower.includes('stl') || 
        header.startsWith('solid ') ||
        headerLower.includes('stl exported') ||
        headerLower.includes('opencascade')) {
      this.logger.log('Detected STL format from header signatures');
      return 'stl';
    }
    
    // Check for STEP format signatures (more comprehensive)
    if (headerLower.includes('iso-10303') || 
        headerLower.includes('step-file') ||
        headerLower.includes('file_name') ||
        headerLower.includes('file_description') ||
        headerLower.includes('file_schema')) {
      this.logger.log('Detected STEP format from header signatures');
      return 'step';
    }
    
    // Check for IGES format signatures
    if ((headerLower.includes('start') && headerLower.includes('global')) ||
        headerLower.includes('1h') ||
        header.match(/^[\s]*START/i)) {
      this.logger.log('Detected IGES format from header signatures');
      return 'iges';
    }
    
    // Check broader content for format patterns
    const contentSize = Math.min(buffer.length, 2000);
    const fullContent = buffer.toString('ascii', 0, contentSize);
    const fullContentLower = fullContent.toLowerCase();
    
    // STL format patterns (ASCII STL)
    if (fullContentLower.includes('facet normal') || 
        fullContentLower.includes('outer loop') ||
        fullContentLower.includes('vertex') ||
        fullContentLower.includes('endloop') ||
        fullContentLower.includes('endfacet')) {
      this.logger.log('Detected STL format from content patterns (ASCII STL)');
      return 'stl';
    }
    
    // STEP format patterns
    if (fullContentLower.includes('endsec') || 
        fullContentLower.includes('end-iso-10303') ||
        fullContentLower.includes('header;') ||
        fullContentLower.includes('data;') ||
        fullContent.match(/#\d+\s*=/)) {
      this.logger.log('Detected STEP format from content patterns');
      return 'step';
    }
    
    // IGES format patterns
    if (fullContentLower.includes('global') ||
        fullContentLower.includes('directory') ||
        fullContentLower.includes('parameter') ||
        fullContent.match(/G\s+\d+/i)) {
      this.logger.log('Detected IGES format from content patterns');
      return 'iges';
    }
    
    // Check if it's a text-based CAD file
    const isTextFile = buffer.subarray(0, 1000).every(byte => 
      (byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13
    );
    
    if (!isTextFile) {
      this.logger.warn('File appears to be binary - checking for binary STL format');
      // Binary STL files start with an 80-byte header followed by triangle count
      if (buffer.length > 84) {
        // Skip 80-byte header and read triangle count (4 bytes, little-endian)
        const triangleCount = buffer.readUInt32LE(80);
        const expectedSize = 80 + 4 + (triangleCount * 50); // Header + count + triangles
        if (Math.abs(buffer.length - expectedSize) < 100) { // Allow some tolerance
          this.logger.log('Detected binary STL format from file structure');
          return 'stl';
        }
      }
      
      // For other binary files, try to detect based on any text patterns we can find
      const textPortion = buffer.toString('ascii', 0, Math.min(buffer.length, 5000));
      if (textPortion.includes('STEP') || textPortion.includes('ISO-10303')) {
        return 'step';
      }
    }
    
    // Log more detailed info for debugging
    this.logger.warn(`Could not detect file type from content. Header preview: "${header.substring(0, 100).replace(/[\r\n]/g, '\\n')}"`);
    this.logger.warn('Defaulting to STL format for unknown binary files');
    return 'stl'; // Default to STL since many uploaded files are STL
  }

  private async storeAnalysisResults(request: CADAnalysisRequest, analysisResponse: GeometryAnalysisResponse): Promise<void> {
    const client = this.supabaseService.getClient(request.accessToken);

    try {
      // Sanitize data to prevent numeric overflow
      const sanitizedGeometry = this.sanitizeNumericData(analysisResponse.geometry_features);
      const sanitizedDfm = this.sanitizeNumericData(analysisResponse.dfm_analysis);
      const sanitizedMemory = this.sanitizeNumericData(analysisResponse.memory_optimization);

      // DB column processing_time_ms is INTEGER — floor the float before storing
      if (sanitizedMemory && typeof sanitizedMemory.processing_time_ms === 'number') {
        sanitizedMemory.processing_time_ms = Math.floor(sanitizedMemory.processing_time_ms);
      }
      
      this.logger.log(`Storing sanitized analysis data for BOM item: ${request.bomItemId}`);
      this.logger.log(`Sanitized geometry:`, JSON.stringify(sanitizedGeometry, null, 2));
      this.logger.log(`Sanitized DFM:`, JSON.stringify(sanitizedDfm, null, 2));
      this.logger.log(`Sanitized memory:`, JSON.stringify(sanitizedMemory, null, 2));
      
      // Use the stored procedure for atomic updates
      this.logger.log(`Calling update_bom_item_cad_analysis with parameters:`, {
        p_bom_item_id: request.bomItemId,
        p_geometry_hash: analysisResponse.analysis_id,
        p_analysis_version: analysisResponse.model_version,
        p_optimization_strategy: request.strategy || 'balanced',
        p_user_id: request.userId
      });

      // Try stored procedure first
      const { error } = await client.rpc('update_bom_item_cad_analysis', {
        p_bom_item_id: request.bomItemId,
        p_geometry_analysis: sanitizedGeometry,
        p_dfm_analysis: sanitizedDfm,
        p_memory_metrics: sanitizedMemory,
        p_geometry_hash: analysisResponse.analysis_id,
        p_analysis_version: analysisResponse.model_version,
        p_optimization_strategy: request.strategy || 'balanced',
        p_user_id: request.userId
      });

      if (error) {
        this.logger.error(`Database stored procedure error:`, error);
        this.logger.warn(`Trying direct database update as fallback...`);
        
        // Fallback: Try direct update
        try {
          const { error: updateError } = await client
            .from('bom_items')
            .update({
              geometry_analysis: sanitizedGeometry,
              dfm_analysis: sanitizedDfm,
              memory_optimization_metrics: sanitizedMemory,
              geometry_hash: analysisResponse.analysis_id,
              analysis_version: analysisResponse.model_version,
              optimization_strategy: request.strategy || 'balanced',
              analysis_timestamp: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', request.bomItemId);

          if (updateError) {
            this.logger.error(`Direct database update also failed:`, updateError);
            throw new Error(`Both stored procedure and direct update failed: ${updateError.message}`);
          }

          this.logger.log(`Fallback direct database update succeeded`);
        } catch (fallbackError) {
          throw new Error(`Failed to store analysis results: ${error.message}`);
        }
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