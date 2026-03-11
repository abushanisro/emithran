'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Cpu, 
  Gauge, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  BarChart3, 
  Loader2, 
  RefreshCw, 
  Zap,
  Factory,
  TrendingDown,
  Info,
  ExternalLink,
  History
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { toast } from 'sonner';
import { BOMItem } from '@/lib/api/hooks/useBOMItems';

interface CADAnalysisData {
  id: string;
  partNumber: string;
  analysisTimestamp: string;
  analysisVersion: string;
  optimizationStrategy: string;
  geometryFeatures: {
    volumeMm3: number;
    surfaceAreaMm2: number;
    complexityScore: number;
    fullAnalysis: any;
  };
  dfmAnalysis: {
    manufacturabilityScore: number;
    difficultyLevel: string;
    recommendedProcesses: string[];
    warnings: any[];
    fullAnalysis: any;
  };
  memoryOptimization: {
    memoryReductionPercent: number;
    processingTimeMs: number;
    lodLevelsAvailable: number;
    fullMetrics: any;
  };
  analysisFreshness: string;
  manufacturingReadiness: string;
}

interface AnalysisHistory {
  id: string;
  analysisVersion: string;
  optimizationStrategy: string;
  processingTimeMs: number;
  memoryReductionPercent: number;
  cacheHit: boolean;
  manufacturabilityScore: number;
  difficultyLevel: string;
  warningsCount: number;
  recommendationsCount: number;
  createdAt: string;
}

interface CADAnalysisPanelProps {
  item: BOMItem;
  onUpdate?: () => void;
}

export function CADAnalysisPanel({ item, onUpdate }: CADAnalysisPanelProps) {
  const [analysisData, setAnalysisData] = useState<CADAnalysisData | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [strategy, setStrategy] = useState<'aggressive' | 'balanced' | 'conservative'>('balanced');

  useEffect(() => {
    if (item.file3dPath) {
      loadAnalysisData();
      loadAnalysisHistory();
    }
  }, [item.id]);

  const loadAnalysisData = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ success: boolean; analysis: CADAnalysisData }>
        (`/bom-items/${item.id}/cad-analysis`);
      
      if (response?.success && response.analysis) {
        setAnalysisData(response.analysis);
      } else {
        setAnalysisData(null);
      }
    } catch (error: any) {
      if (!error.message?.includes('No CAD analysis found')) {
        console.error('Failed to load analysis data:', error);
      }
      setAnalysisData(null);
    } finally {
      setLoading(false);
    }
  };

  const loadAnalysisHistory = async () => {
    try {
      const response = await apiClient.get<{ success: boolean; history: AnalysisHistory[] }>
        (`/bom-items/${item.id}/cad-analysis/history?limit=5`);
      
      if (response?.success && response.history) {
        setAnalysisHistory(response.history);
      }
    } catch (error) {
      console.error('Failed to load analysis history:', error);
    }
  };

  const runAnalysis = async () => {
    if (!item.file3dPath) {
      toast.error('Please upload a 3D model file first (STEP, IGES, STL)');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await apiClient.post<any>(`/bom-items/${item.id}/analyze-cad`, {
        strategy,
        forceReanalysis: false
      });

      if (response?.success) {
        toast.success(`CAD analysis completed for ${item.name}`, {
          description: `Processing time: ${(response.analysis.processingTimeMs / 1000).toFixed(1)}s`
        });
        
        // Reload analysis data
        await loadAnalysisData();
        await loadAnalysisHistory();
        onUpdate?.();
      }
    } catch (error: any) {
      console.error('Analysis failed:', error);
      let errorMessage = 'CAD analysis failed. Please try again.';
      
      if (error.message?.includes('CAD engine')) {
        errorMessage = 'CAD engine is not available. Please contact support.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'Analysis timed out. The file may be too complex.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast.error(errorMessage);
    } finally {
      setAnalyzing(false);
    }
  };

  const getDifficultyColor = (level: string | null | undefined) => {
    if (!level) return 'text-gray-600';
    switch (level.toLowerCase()) {
      case 'easy': return 'text-green-600';
      case 'medium': return 'text-yellow-600';
      case 'hard': return 'text-orange-600';
      case 'very_hard': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getManufacturabilityColor = (score: number) => {
    if (score >= 0.8) return 'text-green-600';
    if (score >= 0.6) return 'text-yellow-600';
    if (score >= 0.4) return 'text-orange-600';
    return 'text-red-600';
  };

  const getFreshnessColor = (freshness: string) => {
    switch (freshness) {
      case 'fresh': return 'text-green-600';
      case 'recent': return 'text-yellow-600';
      case 'stale': return 'text-orange-600';
      default: return 'text-gray-600';
    }
  };

  if (!item.file3dPath) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            CAD Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">
              No 3D model available for analysis
            </p>
            <p className="text-xs text-muted-foreground">
              Upload a STEP, IGES, or STL file to enable advanced CAD analysis
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            CAD Analysis
            {analysisData && (
              <Badge 
                variant={analysisData.analysisFreshness === 'fresh' ? 'default' : 'secondary'}
                className="ml-2"
              >
                {analysisData.analysisFreshness}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <select 
              value={strategy} 
              onChange={(e) => setStrategy(e.target.value as any)}
              className="text-xs border rounded px-2 py-1"
              disabled={analyzing}
            >
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </select>
            <Button 
              onClick={runAnalysis} 
              disabled={analyzing || loading}
              size="sm"
              variant={analysisData ? "outline" : "default"}
            >
              {analyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {analyzing ? 'Analyzing...' : analysisData ? 'Re-analyze' : 'Analyze'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !analysisData ? (
          <div className="text-center py-8">
            <Zap className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground mb-4">
              No analysis data available
            </p>
            <p className="text-xs text-muted-foreground mb-4">
              Click "Analyze" to perform advanced CAD analysis with DFM insights
            </p>
          </div>
        ) : (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="geometry">Geometry</TabsTrigger>
              <TabsTrigger value="dfm">DFM Analysis</TabsTrigger>
              <TabsTrigger value="performance">Performance</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              {/* Manufacturing Readiness */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Manufacturability</span>
                    <span className={`text-sm font-medium ${getManufacturabilityColor(analysisData.dfmAnalysis.manufacturabilityScore)}`}>
                      {(analysisData.dfmAnalysis.manufacturabilityScore * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress 
                    value={analysisData.dfmAnalysis.manufacturabilityScore * 100} 
                    className="h-2"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Memory Optimization</span>
                    <span className="text-sm font-medium text-blue-600">
                      {analysisData.memoryOptimization.memoryReductionPercent?.toFixed(1) || '0.0'}%
                    </span>
                  </div>
                  <Progress 
                    value={Math.min(100, analysisData.memoryOptimization.memoryReductionPercent || 0)} 
                    className="h-2"
                  />
                </div>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 border rounded">
                  <div className="flex items-center justify-center mb-2">
                    <Gauge className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="text-lg font-semibold">
                    {analysisData.geometryFeatures.complexityScore.toFixed(1)}
                  </div>
                  <div className="text-xs text-muted-foreground">Complexity Score</div>
                </div>
                <div className="text-center p-3 border rounded">
                  <div className="flex items-center justify-center mb-2">
                    <Factory className={`h-5 w-5 ${getDifficultyColor(analysisData.dfmAnalysis.difficultyLevel)}`} />
                  </div>
                  <div className={`text-lg font-semibold capitalize ${getDifficultyColor(analysisData.dfmAnalysis.difficultyLevel)}`}>
                    {analysisData.dfmAnalysis.difficultyLevel?.replace('_', ' ') || 'Unknown'}
                  </div>
                  <div className="text-xs text-muted-foreground">Difficulty</div>
                </div>
                <div className="text-center p-3 border rounded">
                  <div className="flex items-center justify-center mb-2">
                    <Clock className="h-5 w-5 text-green-600" />
                  </div>
                  <div className="text-lg font-semibold">
                    {analysisData.memoryOptimization.processingTimeMs != null ? (analysisData.memoryOptimization.processingTimeMs / 1000).toFixed(1) : '0.0'}s
                  </div>
                  <div className="text-xs text-muted-foreground">Analysis Time</div>
                </div>
              </div>

              {/* Recommended Processes */}
              {(analysisData.dfmAnalysis.recommendedProcesses?.length ?? 0) > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Recommended Processes</h4>
                  <div className="flex flex-wrap gap-2">
                    {(analysisData.dfmAnalysis.recommendedProcesses || []).map((process, index) => (
                      <Badge key={index} variant="secondary">
                        {process}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* DFM Warnings */}
              {(analysisData.dfmAnalysis.warnings?.length ?? 0) > 0 && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {(analysisData.dfmAnalysis.warnings?.length ?? 0)} manufacturing issue{(analysisData.dfmAnalysis.warnings?.length ?? 0) !== 1 ? 's' : ''} detected. 
                    Check DFM Analysis tab for details.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="geometry" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Physical Properties</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Volume:</span>
                      <span className="font-medium">
                        {(analysisData.geometryFeatures.volumeMm3 / 1000).toFixed(2)} cm³
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Surface Area:</span>
                      <span className="font-medium">
                        {(analysisData.geometryFeatures.surfaceAreaMm2 / 100).toFixed(1)} cm²
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Complexity:</span>
                      <span className="font-medium">
                        {analysisData.geometryFeatures.complexityScore.toFixed(1)}/10
                      </span>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Analysis Info</h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Strategy:</span>
                      <span className="font-medium capitalize">{analysisData.optimizationStrategy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Version:</span>
                      <span className="font-medium">{analysisData.analysisVersion}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Analyzed:</span>
                      <span className={`font-medium ${getFreshnessColor(analysisData.analysisFreshness)}`}>
                        {new Date(analysisData.analysisTimestamp).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="dfm" className="space-y-4">
              {/* Manufacturability Overview */}
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium">Manufacturing Assessment</h4>
                  <Badge variant={
                    analysisData.dfmAnalysis.manufacturabilityScore >= 0.8 ? 'default' :
                    analysisData.dfmAnalysis.manufacturabilityScore >= 0.6 ? 'secondary' : 'destructive'
                  }>
                    {analysisData.manufacturingReadiness?.replace('_', ' ')}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Overall Score:</span>
                    <span className={`font-medium ${getManufacturabilityColor(analysisData.dfmAnalysis.manufacturabilityScore)}`}>
                      {(analysisData.dfmAnalysis.manufacturabilityScore * 100).toFixed(1)}%
                    </span>
                  </div>
                  <Progress 
                    value={analysisData.dfmAnalysis.manufacturabilityScore * 100} 
                    className="h-2"
                  />
                </div>
              </div>

              {/* Manufacturing Warnings */}
              {(analysisData.dfmAnalysis.warnings?.length ?? 0) > 0 ? (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Manufacturing Issues</h4>
                  {(analysisData.dfmAnalysis.warnings ?? []).map((warning, index) => (
                    <Alert key={index} variant={warning.type === 'critical' ? 'destructive' : 'default'}>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="space-y-1">
                          <p className="font-medium">{warning.message}</p>
                          {warning.costImpactPercent && (
                            <p className="text-xs text-muted-foreground">
                              Cost impact: +{warning.costImpactPercent}%
                            </p>
                          )}
                          {warning.recommendation && (
                            <p className="text-xs text-blue-600">
                              Recommendation: {warning.recommendation}
                            </p>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              ) : (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    No significant manufacturing issues detected. This part appears well-designed for production.
                  </AlertDescription>
                </Alert>
              )}
            </TabsContent>

            <TabsContent value="performance" className="space-y-4">
              {/* Memory Optimization */}
              <div className="p-4 border rounded-lg">
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4" />
                  Memory Optimization
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Memory Reduction:</span>
                      <span className="font-medium text-green-600">
                        {analysisData.memoryOptimization.memoryReductionPercent?.toFixed(1) ?? '0.0'}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">LOD Levels:</span>
                      <span className="font-medium">
                        {analysisData.memoryOptimization.lodLevelsAvailable}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Processing Time:</span>
                      <span className="font-medium">
                        {analysisData.memoryOptimization.processingTimeMs != null ? (analysisData.memoryOptimization.processingTimeMs / 1000).toFixed(1) : '0.0'}s
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Strategy:</span>
                      <span className="font-medium capitalize">
                        {analysisData.optimizationStrategy}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Analysis History */}
              {analysisHistory.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Recent Analyses
                  </h4>
                  <div className="space-y-2">
                    {analysisHistory.map((entry, index) => (
                      <div key={entry.id} className="flex items-center justify-between p-2 border rounded text-sm">
                        <div className="flex items-center gap-2">
                          <Badge variant={entry.cacheHit ? 'secondary' : 'outline'} className="text-xs">
                            {entry.cacheHit ? 'Cached' : 'Fresh'}
                          </Badge>
                          <span className="text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            {(entry.processingTimeMs / 1000).toFixed(1)}s
                          </span>
                          <span className={`text-xs ${getManufacturabilityColor(entry.manufacturabilityScore)}`}>
                            {(entry.manufacturabilityScore * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}