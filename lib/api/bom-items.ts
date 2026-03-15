import { apiClient } from './client';

export interface CADAnalysisResult {
  success: boolean;
  analysis: {
    id: string;
    partNumber?: string;
    analysisTimestamp: string;
    analysisVersion: string;
    optimizationStrategy: string;
    geometryFeatures: {
      volumeMm3?: number;
      surfaceAreaMm2?: number;
      complexityScore?: number;
      boundingBox?: any;
      manufacturingFeatures?: any;
      fullAnalysis?: any;
    };
    dfmAnalysis: {
      manufacturabilityScore?: number;
      difficultyLevel?: string;
      recommendedProcesses?: string[];
      warnings?: string[];
      aiInsights?: {
        costOptimization: string[];
        designImprovements: string[];
        materialSuggestions: string[];
        processRecommendations: string[];
      };
      competitiveAnalysis?: any;
      sustainabilityMetrics?: any;
      costFactors?: any;
      geometricConstraints?: any;
      manufacturingWarnings?: string[];
      fullAnalysis?: any;
    };
    memoryOptimization: {
      memoryReductionPercent?: number;
      processingTimeMs?: number;
      lodLevelsAvailable?: number;
      cacheEfficiency?: number;
      compressionRatio?: number;
      fullMetrics?: any;
    };
    analysisFreshness: string;
    manufacturingReadiness?: string;
  };
  processingTimeMs?: number;
  metadata?: { timestamp: string };
}

export interface AnalyzeCADRequest {
  strategy?: string;
  forceReanalysis?: boolean;
}

export const bomItemsApi = {
  /**
   * Analyze CAD for a BOM item with optional process-specific context
   */
  analyzeCAD: async (
    bomItemId: string, 
    forceReanalysis = false,
    processContext?: {
      selectedProcess?: string;
      processCategory?: string;
      processSubCategory?: string;
      dfmContext?: string;
      applicableFeatures?: string[];
      annualVolume?: number;
      material?: string;
      materialGrade?: string;
      geometryContext?: any;
    }
  ): Promise<CADAnalysisResult> => {
    try {
      const requestBody = {
        strategy: 'balanced',
        forceReanalysis,
        ...(processContext && {
          processContext: {
            ...processContext
          }
        })
      };

      console.log('CAD Analysis Request:', { bomItemId, requestBody });

      const response = await apiClient.post<any>(
        `/bom-items/${bomItemId}/analyze-cad`,
        requestBody,
        {
          timeout: 120000, // Extended to 120 seconds for process-specific analysis
          priority: 'high' // High priority for interactive DFM analysis
        }
      );
      
      // Handle different response formats from backend
      if (response && typeof response === 'object') {
        // If response has analysis field directly
        if (response.analysis) {
          return response;
        }
        
        // If response is the analysis data itself (backend format mismatch)
        if (response.id || response.geometryFeatures || response.dfmAnalysis) {
          return {
            success: true,
            analysis: response as any,
            metadata: { timestamp: new Date().toISOString() }
          };
        }
        
        // If response indicates success but has different structure
        if (response.success !== false) {
          return {
            success: true,
            analysis: response as any,
            metadata: { timestamp: new Date().toISOString() }
          };
        }
        
        // Default success case
        return response;
      }
      
      // If no valid analysis data is available, throw error
      throw new Error('No valid CAD analysis data available');
      
    } catch (error) {
      throw error;
    }
  },

  /**
   * Get CAD analysis results for a BOM item
   */
  getCADAnalysis: async (bomItemId: string): Promise<CADAnalysisResult> => {
    const response = await apiClient.get<CADAnalysisResult>(
      `/bom-items/${bomItemId}/cad-analysis`
    );
    return response;
  },

  /**
   * Get CAD analysis history for a BOM item
   */
  getCADAnalysisHistory: async (bomItemId: string, limit = 5): Promise<{ success: boolean; history: any[] }> => {
    const response = await apiClient.get<{ success: boolean; history: any[] }>(
      `/bom-items/${bomItemId}/cad-analysis/history?limit=${limit}`
    );
    return response;
  },

  /**
   * Get file URL for a BOM item
   */
  getFileUrl: async (bomItemId: string, fileType: '3d' | '2d'): Promise<{ success: boolean; url: string }> => {
    const response = await apiClient.get<{ success: boolean; url: string }>(
      `/bom-items/${bomItemId}/file-url/${fileType}`
    );
    return response;
  }
};