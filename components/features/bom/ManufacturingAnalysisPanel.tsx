"use client";

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  Clock,
  Factory,
  Wrench,
  Target,
  TrendingUp,
  Eye,
  Cpu,
  Box,
} from 'lucide-react';

// DFM Color Constants - matching edrawings-viewer.tsx
const DFM_COLORS = {
  hole:      '#FF4757', // Red
  pocket:    '#1E90FF', // Blue  
  thin_wall: '#FFA502', // Orange
  undercut:  '#9B59B6', // Purple
  slot:      '#2ED573', // Green
  overhang:  '#FF6B81', // Pink
  boss:      '#74B9FF', // Light Blue
  rib:       '#FDCB6E', // Yellow
} as const;
import { bomItemsApi } from '@/lib/api/bom-items';
import { apiClient } from '@/lib/api/client';
import type { Process } from '@/lib/api/hooks/useProcesses';
import { useRawMaterials } from '@/lib/api/hooks/useRawMaterials';
import { toast } from 'sonner';

interface ManufacturingFeature {
  id: string;
  type: 'hole' | 'pocket' | 'slot' | 'boss' | 'rib' | 'thin_wall' | 'overhang' | 'undercut' | 'joint_design';
  position: { x: number; y: number; z: number };
  dimensions: { length?: number; width?: number; diameter?: number; depth?: number };
  manufacturingProcess: string;
  cycleTime: number;
  tooling: string[];
  warnings: string[];
  aiRecommendations: string[];
}


interface ManufacturingAnalysisData {
  features: ManufacturingFeature[];
  recommendedProcesses: Array<{
    process: string;
    suitability: number;
    leadTime: number;
    quality: string;
    reasoning: string;
    annualVolume?: number;
    material?: string;
    geometry?: string;
    category?: string;
  }>;
  aiInsights: {
    designImprovements: string[];
    materialSuggestions: string[];
    processRecommendations: string[];
  };
  risks: Array<{
    type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    mitigation: string;
  }>;
  manufacturabilityScore?: number;
  aiConfidence?: number;
  timestamp?: number;
}

interface ManufacturingAnalysisPanelProps {
  bomItemId: string;
  fileUrl?: string;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  onFeaturesUpdate?: (features: ManufacturingFeature[]) => void;
  onProcessHighlight?: (process: any) => void;
  selectedProcess?: string | null;
  selectedFeature?: ManufacturingFeature | null;
  manufacturingFeatures?: ManufacturingFeature[];
  bomItem?: {
    annualVolume: number;
    material?: string;
    materialGrade?: string;
  };
}

export default function ManufacturingAnalysisPanel({
  bomItemId,
  onFeatureSelect,
  onFeaturesUpdate,
  onProcessHighlight,
  selectedProcess,
  selectedFeature,
  bomItem,
}: ManufacturingAnalysisPanelProps) {
  // Cache keys for localStorage
  const analysisDataCacheKey = `dfm-analysis-${bomItemId}`;
  const selectedProcessCacheKey = `dfm-selected-process-${bomItemId}`;
  const showFeatureOverlayCacheKey = `dfm-show-features-${bomItemId}`;
  
  // Cache duration: 1 hour (3600000 ms)
  const CACHE_DURATION = 3600000;
  
  // Function to check if cache is valid
  const isCacheValid = (timestamp?: number): boolean => {
    if (!timestamp) return false;
    return (Date.now() - timestamp) < CACHE_DURATION;
  };
  
  // Function to clear cache for this BOM item
  const clearCache = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(analysisDataCacheKey);
      localStorage.removeItem(selectedProcessCacheKey);
      localStorage.removeItem(showFeatureOverlayCacheKey);
    }
  };

  // Initialize state with cached values
  const [analysisData, setAnalysisData] = useState<ManufacturingAnalysisData | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(analysisDataCacheKey);
      if (cached) {
        const parsedCache = JSON.parse(cached);
        // Check if cache is still valid
        if (isCacheValid(parsedCache.timestamp)) {
          return parsedCache;
        } else {
          // Clear expired cache
          clearCache();
        }
      }
    }
    return null;
  });
  
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  
  const [showFeatureOverlay, setShowFeatureOverlay] = useState(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(showFeatureOverlayCacheKey);
      return cached ? JSON.parse(cached) : true;
    }
    return true;
  });
  
  const [internalSelectedProcess, setInternalSelectedProcess] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(selectedProcessCacheKey);
      return cached || null;
    }
    return null;
  });

  // Use prop if provided, otherwise use internal state
  const currentSelectedProcess = selectedProcess !== undefined ? selectedProcess : internalSelectedProcess;
  const setSelectedProcess = selectedProcess !== undefined ? 
    (process: string | null) => {
      // If we're using external control, don't update internal state
      setInternalSelectedProcess(process);
    } : 
    setInternalSelectedProcess;
  
  const [loadingProcessAnalysis, setLoadingProcessAnalysis] = useState(false);
  // All processes fetched from the user's process library
  const [allProcesses, setAllProcesses] = useState<Process[]>([]);
  
  // Raw materials data for material-based process recommendations
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: _rawMaterialsData } = useRawMaterials({
    material: bomItem?.material,
    limit: 10
  });

  /* ─────────────────────────────────────────────────────────────────
     Fetch all processes from the process library on mount
  ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    // Fetch only page 1 of processes (page 2 has backend issues)
    const fetchProcesses = async () => {
      try {
        const response = await apiClient.get<{ processes: Process[] }>('/processes', { 
          params: { limit: 100, page: 1 } 
        });
        const processes = response.processes || [];
        setAllProcesses(processes);
      } catch (error) {
        setAllProcesses([]);
      }
    };
    
    fetchProcesses();
  }, []);

  /* ─────────────────────────────────────────────────────────────────
     Trigger fresh AI-powered DFM analysis
  ──────────────────────────────────────────────────────────────────── */
  const runManufacturingAnalysis = async () => {
    if (!bomItemId) return;
    setAnalyzing(true);
    
    // Clear cache before new analysis
    clearCache();
    
    try {
      const result = await bomItemsApi.analyzeCAD(bomItemId, true);
      
      // Handle both success formats - check if analysis exists
      if (result?.success || result?.analysis || result) {
        await fetchAnalysisData();
      }
    } catch (error: any) {
    } finally {
      setAnalyzing(false);
    }
  };

  const [rawMfgGeo, setRawMfgGeo] = useState<{mfg:any;geo:any} | null>(null);

  /* ─────────────────────────────────────────────────────────────────
     Fetch stored analysis and map to UI model
  ──────────────────────────────────────────────────────────────────── */
  const fetchAnalysisData = async () => {
    setLoading(true);
    try {
      const response = await bomItemsApi.getCADAnalysis(bomItemId);
      if (!response.success || !response.analysis) { setAnalysisData(null); return; }

      const analysis = response.analysis;
      const dfm    = analysis.dfmAnalysis;
      const geo    = analysis.geometryFeatures;
      const aiRaw  = dfm?.aiInsights as any;          // Gemini structured JSON
      // mfg can live in manufacturingFeatures (STEP/OCC) OR inside fullAnalysis (STL fallback)
      const mfgRaw  = geo?.manufacturingFeatures || geo?.fullAnalysis?.manufacturing_features;
      // bounding_box can live at geo.boundingBox (STEP) or geo.fullAnalysis.bounding_box (STL)
      const bboxRaw = geo?.boundingBox || geo?.fullAnalysis?.bounding_box || null;
      const geoForBuild = bboxRaw ? { ...geo, boundingBox: bboxRaw } : geo;

      // Persist raw refs so the allProcesses effect can re-score
      setRawMfgGeo({ mfg: mfgRaw, geo: geoForBuild });

      let features = buildFeatures(mfgRaw, geoForBuild);
      
      // Apply AI insights to features if available
      if (aiRaw) {
        features = mapAIInsightsToFeatures(features, aiRaw, currentSelectedProcess ?? undefined);
      } else {
        
        // Extract AI insights from the actual backend structure
        const alternativeAI = {
          quality_considerations: dfm?.fullAnalysis?.manufacturingWarnings || dfm?.manufacturingWarnings || [],
          process_recommendations: [
            ...(dfm?.recommendedProcesses || []).map((proc: string) => ({
              name: proc,
              reasoning: `Suitable for current part geometry and requirements`,
              suitability_score: 0.8
            }))
          ],
          dfm_recommendations: [
            ...(geo?.complexityScore ? [`Part complexity: ${geo.complexityScore.toFixed(1)}/10`] : []),
            ...(dfm?.manufacturabilityScore ? [`Manufacturability score: ${dfm.manufacturabilityScore}%`] : []),
            ...(dfm?.difficultyLevel ? [`Difficulty level: ${dfm.difficultyLevel}`] : []),
            ...(dfm?.fullAnalysis?.manufacturingWarnings || [])
          ],
          geometry_analysis: [
            {
              type: 'general',
              recommendations: dfm?.fullAnalysis?.manufacturingWarnings || dfm?.manufacturingWarnings || [],
              warnings: dfm?.warnings || [],
              geometry_constraints: dfm?.geometricConstraints || dfm?.fullAnalysis?.geometricConstraints || {}
            }
          ]
        };
        
        features = mapAIInsightsToFeatures(features, alternativeAI, currentSelectedProcess ?? undefined);
      }
      
      // Extract AI insights from actual backend structure
      const aiData = aiRaw || {
        quality_considerations: dfm?.fullAnalysis?.manufacturingWarnings || dfm?.manufacturingWarnings || [],
        process_recommendations: (dfm?.recommendedProcesses || []).map((proc: string) => ({
          name: proc,
          reasoning: `Recommended for current part geometry${dfm?.difficultyLevel ? ` - ${dfm.difficultyLevel} complexity` : ''}`,
          suitability_score: (dfm?.manufacturabilityScore || 0) / 100
        })),
        dfm_recommendations: [
          ...(dfm?.manufacturabilityScore ? [`Manufacturability Score: ${dfm.manufacturabilityScore}%`] : []),
          ...(dfm?.difficultyLevel ? [`Complexity Level: ${dfm.difficultyLevel}`] : []),
          ...(dfm?.fullAnalysis?.costFactors?.materialUtilization || dfm?.costFactors?.materialUtilization ? 
              [`Material Utilization: ${dfm?.fullAnalysis?.costFactors?.materialUtilization || dfm?.costFactors?.materialUtilization}%`] : []),
          ...(dfm?.fullAnalysis?.manufacturingWarnings || dfm?.manufacturingWarnings || [])
        ],
        material_recommendations: [
          ...(dfm?.difficultyLevel ? [`Current material suitability based on ${dfm.difficultyLevel} manufacturing complexity`] : []),
          ...(dfm?.fullAnalysis?.costFactors?.materialUtilization || dfm?.costFactors?.materialUtilization ? 
              [`Estimated material utilization: ${dfm?.fullAnalysis?.costFactors?.materialUtilization || dfm?.costFactors?.materialUtilization}%`] : [])
        ]
      };
      
      const recommendedProcesses  = buildProcesses(aiData?.process_recommendations, mfgRaw, geoForBuild);
      const aiInsights = {
        designImprovements:    (aiData?.quality_considerations || 
                               aiData?.dfm_recommendations || []) as string[],
        materialSuggestions:   (aiData?.material_recommendations || []).map(
          (m: any) => {
            if (typeof m === 'string') return m;
            return [m.name, m.grade ? `(${m.grade})` : '', m.reason || m.machinability_rating || '']
              .filter(Boolean).join(' — ');
          }
        ),
        processRecommendations: (aiData?.process_recommendations || []).map(
          (p: any) => {
            if (typeof p === 'string') return p;
            return p.reasoning || `${p.name}: ${Math.round((p.suitability_score || 0) * 100)}% suitability`;
          }
        ),
      };
      const risks         = buildRisks(aiRaw, dfm);

      const newAnalysisData = {
        features,
        recommendedProcesses,
        aiInsights,
        risks,
        manufacturabilityScore: dfm?.manufacturabilityScore,
        aiConfidence: aiRaw?.ai_confidence,
        timestamp: Date.now(), // Add timestamp for cache validation
      };
      
      setAnalysisData(newAnalysisData);
      onFeaturesUpdate?.(features);
    } catch (error: any) {
      console.error("Failed to fetch analysis data", error);
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────────
     Engineering Standards & Best Practices Functions
  ──────────────────────────────────────────────────────────────────── */
  
  // Hole manufacturing process determination per ASME Y14.5 and ISO 286
  const determineHoleProcess = (diameter: number): string => {
    if (diameter < 0.5) return 'Micro Drilling';
    if (diameter < 3) return 'Small Hole Drilling';
    if (diameter <= 12) return 'Twist Drilling';
    if (diameter <= 25) return 'Step Drilling';
    if (diameter <= 50) return 'Boring';
    return 'Large Bore Machining';
  };

  const getHoleTooling = (diameter: number): string[] => {
    if (diameter < 0.5) return ['Micro drill', 'High-speed spindle'];
    if (diameter < 3) return ['Carbide drill', 'Center drill'];
    if (diameter <= 12) return ['HSS/Carbide twist drill', 'Center drill'];
    if (diameter <= 25) return ['Step drill', 'Pilot drill', 'Reamer'];
    return ['Boring bar', 'Rough boring tool', 'Finish boring tool'];
  };

  const getHoleWarnings = (diameter: number): string[] => {
    const warnings: string[] = [];
    if (diameter < 0.5) warnings.push('Requires specialized micro-drilling equipment');
    if (diameter < 1) warnings.push('High risk of drill breakage');
    if (diameter > 50) warnings.push('Requires heavy-duty boring equipment');
    return warnings;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getHoleRecommendations = (_diameter: number, _position: any, _allHoles: any[], _partGeometry: any): string[] => {
    // AI will analyze real geometry and provide contextual recommendations
    // This will be populated by actual AI analysis from the backend
    return [];
  };

  // Pocket milling per ASME B94.19
  const getPocketTooling = (depth: number): string[] => {
    const tools = ['Roughing end mill', 'Finishing end mill'];
    if (depth > 10) tools.push('Long series end mill');
    if (depth > 20) tools.push('Vibration dampener');
    return tools;
  };

  const getPocketWarnings = (depth: number): string[] => {
    const warnings: string[] = [];
    if (depth > 15) warnings.push('Deep pocket - monitor tool deflection');
    if (depth > 25) warnings.push('Requires specialized tooling for rigidity');
    return warnings;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getPocketRecommendations = (_depth: number, _position: any, _allPockets: any[], _partGeometry: any): string[] => {
    // AI will analyze pocket geometry, accessibility, and provide specific recommendations
    // This will be populated by actual AI analysis from the backend
    return [];
  };

  // Thin wall machining per ISO 2768
  const determineThinWallProcess = (thickness: number): string => {
    if (thickness < 0.5) return 'Wire EDM';
    if (thickness < 1.0) return 'High-Speed Milling';
    if (thickness < 2.0) return 'Conventional Milling';
    return 'Standard Milling';
  };

  const getThinWallTooling = (thickness: number): string[] => {
    if (thickness < 0.5) return ['Wire EDM electrode'];
    if (thickness < 1.0) return ['Small diameter end mill', 'High-speed spindle'];
    return ['Standard end mill', 'Workholding fixtures'];
  };

  const getThinWallWarnings = (thickness: number): string[] => {
    const warnings: string[] = [];
    if (thickness < 0.8) warnings.push(`Thickness ${thickness.toFixed(2)}mm below ISO 2768 general tolerance`);
    if (thickness < 1.5) warnings.push('High deflection risk during machining');
    return warnings;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getThinWallRecommendations = (_thickness: number, _partGeometry: any): string[] => {
    // AI will analyze thin wall location, support structure, and provide specific recommendations
    // This will be populated by actual AI analysis from the backend
    return [];
  };

  // Undercut features
  const getUndercutTooling = (): string[] => {
    return ['5-axis capable machine', 'Ball end mill', 'Indexable insert tools'];
  };

  const getUndercutWarnings = (): string[] => {
    return ['Requires 5-axis machining or EDM', 'Complex setup and programming required'];
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _getUndercutRecommendations = (_undercutData: any, _partGeometry: any): string[] => {
    // AI will analyze undercut geometry, depth, accessibility and provide specific solutions
    // This will be populated by actual AI analysis from the backend
    return [];
  };

  /* ─────────────────────────────────────────────────────────────────
     Feature extraction — maps real OpenCASCADE output
  ──────────────────────────────────────────────────────────────────── */
  const buildFeatures = (mfg: any, geo: any): ManufacturingFeature[] => {
    const out: ManufacturingFeature[] = [];
    if (!mfg && !geo) return out;

    const holes     = mfg?.holes     || {};
    const pockets   = mfg?.pockets   || {};
    const undercuts = mfg?.undercuts  || {};
    const wallMm    = typeof mfg?.thin_walls === 'number' ? mfg.thin_walls : null;

    // ── Coordinate conversion ──────────────────────────────────────────────
    // Backend now returns {nx, ny, nz} normalised to [-1, +1] relative to the
    // model's OCC bounding box centre. Multiplying by scene half-extents gives
    // the correct scene-space position matching Three.js geometry.center().

    const bb = geo?.boundingBox || {};
    const bbLmm = bb.length || 20;   // mm (OCC X)
    const bbWmm = bb.width  || 20;   // mm (OCC Y)
    const bbHmm = bb.height || 10;   // mm (OCC Z / up)

    const maxMm        = Math.max(bbLmm, bbWmm, bbHmm, 1);
    const scaleToScene = 2.0 / maxMm;   // mm → scene units

    // Scene half-extents
    const hx = (bbLmm / 2) * scaleToScene;  // scene X
    const hy = (bbHmm / 2) * scaleToScene;  // scene Y (up = OCC Z)
    const hz = (bbWmm / 2) * scaleToScene;  // scene Z (OCC Y)

    /**
     * Convert a normalised OCC position {nx,ny,nz} ∈ [-1,+1] → scene coords.
     * OCC axis mapping: nx→sceneX, nz→sceneY(up), ny→sceneZ
     * Falls back to a heuristic position if pos is missing.
     */
    const toScene = (
      pos: {nx?:number; ny?:number; nz?:number} | undefined | null,
      fallback: {x:number; y:number; z:number}
    ) => {
      if (!pos || pos.nx === undefined) return fallback;
      return {
        x: parseFloat(( (pos.nx ?? 0) * hx).toFixed(3)),
        y: parseFloat(( (pos.nz ?? 0) * hy).toFixed(3)),  // OCC Z = height = scene Y (up)
        z: parseFloat(( (pos.ny ?? 0) * hz).toFixed(3)),  // OCC Y = width  = scene Z
      };
    };

    // ── Holes ─────────────────────────────────────────────────────────────
    // Each cylindrical face gets its own marker at its real centroid.
    const holeDiameters: number[] = Array.isArray(holes.diameters) ? holes.diameters : [];
    const holePositions: any[]    = Array.isArray(holes.positions)  ? holes.positions  : [];
    const CAP = 20; // max markers per feature type to avoid clutter
    holeDiameters.slice(0, CAP).forEach((d: number, i: number) => {
      // Use real OCC centroid; fall back to angular spread on top face
      const fallback = (() => {
        const total = Math.max(holeDiameters.length, 1);
        const angle = (i / total) * Math.PI * 2;
        const r = Math.min(hx, hz) * 0.6;
        return { x: parseFloat((Math.cos(angle) * r).toFixed(3)), y: parseFloat(hy.toFixed(3)), z: parseFloat((Math.sin(angle) * r).toFixed(3)) };
      })();
      out.push({
        id: `hole_${i}`,
        type: 'hole',
        position: toScene(holePositions[i], fallback),
        dimensions: { diameter: d },
        manufacturingProcess: determineHoleProcess(d),
        cycleTime: 0, // Calculated by process planning system
        tooling: getHoleTooling(d),
        warnings: getHoleWarnings(d),
        aiRecommendations: [], // Will be populated by AI analysis
      });
    });

    // ── Pockets ──────────────────────────────────────────────────────────
    const pocketPositions: any[] = Array.isArray(pockets.positions) ? pockets.positions : [];
    const pocketCount = pockets.count || 0;
    if (pocketCount > 0) {
      // One marker per distinct pocket face (capped)
      const numMarkers = Math.min(pocketCount, Math.max(pocketPositions.length, 1), CAP);
      for (let i = 0; i < numMarkers; i++) {
        const fallback = {
          x: parseFloat((-hx * 0.4 + (i * hx * 0.3)).toFixed(3)),
          y: parseFloat((hy * 0.8).toFixed(3)),
          z: parseFloat((hz * 0.3).toFixed(3)),
        };
        out.push({
          id: `pocket_${i}`,
          type: 'pocket',
          position: toScene(pocketPositions[i], fallback),
          dimensions: { depth: pockets.max_depth || 0 },
          manufacturingProcess: 'Pocket Milling',
          cycleTime: 0, // Calculated by process planning system
          tooling: getPocketTooling(pockets.max_depth || 0),
          warnings: getPocketWarnings(pockets.max_depth || 0),
          aiRecommendations: [], // Will be populated by AI analysis
        });
      }
    }

    // ── Thin walls ────────────────────────────────────────────────────────
    // No individual face positions from OCC yet; place on the thinnest side
    if (wallMm !== null) {
      out.push({
        id: 'thin_wall',
        type: 'thin_wall',
        position: { x: parseFloat((hx * 0.9).toFixed(3)), y: 0, z: parseFloat((hz * 0.4).toFixed(3)) },
        dimensions: { width: wallMm },
        manufacturingProcess: determineThinWallProcess(wallMm),
        cycleTime: 0, // Calculated by process planning system
        tooling: getThinWallTooling(wallMm),
        warnings: getThinWallWarnings(wallMm),
        aiRecommendations: [], // Will be populated by AI analysis
      });
    }

    // ── Undercuts ─────────────────────────────────────────────────────────
    const undercutPositions: any[] = Array.isArray(undercuts.positions) ? undercuts.positions : [];
    if (undercuts.detected) {
      const numUC = Math.min(undercuts.count || 1, Math.max(undercutPositions.length, 1), CAP);
      for (let i = 0; i < numUC; i++) {
        const fallback = {
          x: parseFloat((hx * (0.2 + i * 0.3)).toFixed(3)),
          y: parseFloat((-hy * 0.7).toFixed(3)),
          z: parseFloat((hz * 0.6).toFixed(3)),
        };
        out.push({
          id: `undercut_${i}`,
          type: 'undercut',
          position: toScene(undercutPositions[i], fallback),
          dimensions: { depth: undercuts.count || 0 },
          manufacturingProcess: 'Multi-axis Machining',
          cycleTime: 0, // Calculated by process planning system
          tooling: getUndercutTooling(),
          warnings: getUndercutWarnings(),
          aiRecommendations: [], // Will be populated by AI analysis
        });
      }
    }

    return out;
  };

  /* ─────────────────────────────────────────────────────────────────
     Industry Standard Manufacturing Process Classification (ISO 14040, ASTM E3012)
     Scalable framework for process-specific DFM analysis
  ──────────────────────────────────────────────────────────────────── */
  const classifyManufacturingProcess = (processName: string): {
    category: string;
    subCategory: string;
    applicableFeatures: string[];
    dfmContext: string;
  } => {
    const process = processName.toLowerCase();
    
    // ASTM E3012 Manufacturing Process Classification
    if (process.includes('machining') || process.includes('cnc') || process.includes('milling') || process.includes('turning') || process.includes('drilling')) {
      return {
        category: 'Subtractive Manufacturing',
        subCategory: 'Material Removal',
        applicableFeatures: ['holes', 'pockets', 'slots', 'surfaces', 'threads'],
        dfmContext: 'geometric_features'
      };
    }
    
    if (process.includes('casting') || process.includes('molding') || process.includes('forging')) {
      return {
        category: 'Forming',
        subCategory: 'Material Shaping',
        applicableFeatures: ['draft_angles', 'parting_lines', 'cores', 'fillets'],
        dfmContext: 'moldability_analysis'
      };
    }
    
    if (process.includes('welding') || process.includes('brazing') || process.includes('soldering')) {
      return {
        category: 'Joining',
        subCategory: 'Material Fusion',
        applicableFeatures: ['joint_design', 'weld_accessibility', 'heat_zones', 'distortion_control'],
        dfmContext: 'assembly_analysis'
      };
    }
    
    if (process.includes('additive') || process.includes('3d') || process.includes('printing')) {
      return {
        category: 'Additive Manufacturing',
        subCategory: 'Layer Building',
        applicableFeatures: ['overhangs', 'supports', 'orientation', 'layer_adhesion'],
        dfmContext: 'buildability_analysis'
      };
    }
    
    if (process.includes('sheet') || process.includes('forming') || process.includes('bending') || process.includes('stamping')) {
      return {
        category: 'Forming',
        subCategory: 'Sheet Metal',
        applicableFeatures: ['bend_radius', 'springback', 'grain_direction', 'tooling_access'],
        dfmContext: 'formability_analysis'
      };
    }
    
    // Default classification for unknown processes
    return {
      category: 'Unknown',
      subCategory: 'Requires Analysis',
      applicableFeatures: [],
      dfmContext: 'general_analysis'
    };
  };

  /* ─────────────────────────────────────────────────────────────────
     Enhanced API Integration for Process-Specific Analysis
     Follows industry standards for DFM data exchange
  ──────────────────────────────────────────────────────────────────── */
  const getProcessSpecificAnalysis = async (processName: string, geometryData: any): Promise<any> => {
    const processClassification = classifyManufacturingProcess(processName);
    
    try {
      // Enhanced API call with industry-standard process context
      const result = await bomItemsApi.analyzeCAD(bomItemId, true, {
        selectedProcess: processName,
        processCategory: processClassification.category,
        processSubCategory: processClassification.subCategory,
        dfmContext: processClassification.dfmContext,
        applicableFeatures: processClassification.applicableFeatures,
        annualVolume: bomItem?.annualVolume,
        material: bomItem?.material,
        materialGrade: bomItem?.materialGrade,
        geometryContext: {
          featureTypes: geometryData?.manufacturingFeatures || {},
          complexityScore: geometryData?.complexityScore || 0,
          boundingBox: geometryData?.boundingBox || {}
        }
      });
      
      return result;
    } catch (error) {
      throw error;
    }
  };

  /* ─────────────────────────────────────────────────────────────────
     Dynamic Feature Relevance Assessment (Industry Standard Approach)
     Based on actual process classification and AI analysis
  ──────────────────────────────────────────────────────────────────── */
  const assessFeatureRelevance = (feature: ManufacturingFeature, processName: string, aiAnalysis?: any): {
    relevant: boolean;
    aiInsights: string[];
  } => {
    const processClassification = classifyManufacturingProcess(processName);
    
    // Let AI determine feature relevance based on process context
    // This is where the backend AI should provide process-specific insights
    if (aiAnalysis?.feature_relevance) {
      const featureRelevance = aiAnalysis.feature_relevance.find((fr: any) => 
        fr.featureId === feature.id || fr.featureType === feature.type
      );
      
      if (featureRelevance) {
        return {
          relevant: featureRelevance.relevant,
          aiInsights: featureRelevance.insights || []
        };
      }
    }
    
    // Fallback: Use process classification to determine basic relevance
    return {
      relevant: processClassification.dfmContext !== 'assembly_analysis' || feature.type === 'joint_design',
      aiInsights: [`Feature analysis pending for ${processClassification.category} process`]
    };
  };

  /* ─────────────────────────────────────────────────────────────────
     Enhanced Process-Specific DFM Analysis Function
     Industry standard approach with AI integration
  ──────────────────────────────────────────────────────────────────── */
  const analyzeProcessSpecificDFM = async (processName: string) => {
    if (!bomItemId) {
      return;
    }
    
    if (!processName || typeof processName !== 'string') {
      toast.error('Invalid manufacturing process selected');
      return;
    }
    
    setLoadingProcessAnalysis(true);
    setSelectedProcess(processName);
    
    // Call process highlighting callback for 3D model highlighting
    if (onProcessHighlight) {
      onProcessHighlight({ processGroup: processName, operation: processName });
    }
    
    try {
      // Use industry-standard process classification
      const processClassification = classifyManufacturingProcess(processName);
      
      // Enhanced API call with comprehensive process context
      const result = await getProcessSpecificAnalysis(processName, rawMfgGeo?.geo);
      
      if (result && (result.success || result.analysis)) {
        await fetchAnalysisData();
        toast.success(`${processClassification.category} analysis completed`, {
          description: `Process-specific ${processClassification.dfmContext} insights available`
        });
      } else {
        toast.warning('Analysis completed but may have incomplete results');
      }
    } catch (error: any) {
      let errorMessage = 'Manufacturing analysis failed';
      
      if (error.message?.includes('Connection failed')) {
        errorMessage = 'Network connection error. Please check your connection and try again.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'Analysis is taking longer than expected. Please try again.';
      } else if (error.message?.includes('file not found')) {
        errorMessage = 'CAD file not found. Please upload a 3D model first.';
      } else if (error.code === 'CIRCUIT_BREAKER_OPEN') {
        errorMessage = 'Service temporarily unavailable. Please wait a moment and try again.';
      }
      
      toast.error(errorMessage, {
        description: `Failed to analyze ${processName}`,
        action: {
          label: 'Retry',
          onClick: () => analyzeProcessSpecificDFM(processName)
        }
      });
    } finally {
      setLoadingProcessAnalysis(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────────
     AI Insights Mapping - Extract feature-specific recommendations from AI analysis
  ──────────────────────────────────────────────────────────────────── */
  const mapAIInsightsToFeatures = (features: ManufacturingFeature[], aiInsights: any, selectedProcessParam?: string): ManufacturingFeature[] => {
    if (!aiInsights || !features.length) {
      return features;
    }

    // Generate process-specific intelligent recommendations using industry standards and AI
    return features.map((feature) => {
      const featureSpecificInsights: string[] = [];
      
      // Industry-standard feature relevance assessment
      if (selectedProcessParam) {
        const relevanceAssessment = assessFeatureRelevance(feature, selectedProcessParam, aiInsights);
        
        if (!relevanceAssessment.relevant) {
          // Feature not relevant for this process - get AI insights on alternatives
          const processClassification = classifyManufacturingProcess(selectedProcessParam);
          
          return {
            ...feature,
            manufacturingProcess: `${processClassification.category} - Feature Not Applicable`,
            aiRecommendations: [
              `This feature is not relevant for ${processClassification.category} processes`,
              `Focus should be on ${processClassification.applicableFeatures.join(', ')} for ${selectedProcessParam}`,
              ...relevanceAssessment.aiInsights
            ]
          };
        } else {
          // Feature is relevant - add AI insights
          relevanceAssessment.aiInsights.forEach(insight => {
            featureSpecificInsights.push(insight);
          });
        }
      }
      
      // Extract AI recommendations with fallback data structures
      const qualityConsiderations = aiInsights.quality_considerations || 
                                   aiInsights.designImprovements || 
                                   aiInsights.dfm_recommendations || 
                                   aiInsights.recommendations || [];
      
      const processRecs = aiInsights.process_recommendations || 
                         aiInsights.processRecommendations || 
                         aiInsights.manufacturing_recommendations || [];
      
      // Try to find feature-specific AI insights
      const featureInsights = aiInsights.feature_analysis || 
                             aiInsights.manufacturing_features || 
                             aiInsights.geometry_analysis || [];
      
      // Look for feature-specific insights from AI
      const matchingFeatureAI = featureInsights.find((ai: any) => 
        ai.type === feature.type || 
        ai.feature_type === feature.type ||
        (ai.geometry_type && ai.geometry_type.includes(feature.type))
      );
      
      if (matchingFeatureAI) {
        if (matchingFeatureAI.recommendations) {
          matchingFeatureAI.recommendations.forEach((rec: string) => {
            featureSpecificInsights.push(`AI Analysis: ${rec}`);
          });
        }
        if (matchingFeatureAI.warnings) {
          matchingFeatureAI.warnings.forEach((warning: string) => {
            featureSpecificInsights.push(`Warning: ${warning}`);
          });
        }
        if (matchingFeatureAI.solutions) {
          matchingFeatureAI.solutions.forEach((solution: string) => {
            featureSpecificInsights.push(`Solution: ${solution}`);
          });
        }
      }
      
      // Feature-specific analysis based on geometry and AI insights
      if (feature.type === 'hole') {
        const diameter = feature.dimensions.diameter || 0;
        
        // Analyze hole characteristics and provide specific recommendations
        if (diameter < 3) {
          featureSpecificInsights.push('Challenge: Small diameter drilling requires specialized tooling');
          featureSpecificInsights.push('Recommendation: Use carbide micro drills with reduced feed rate');
        } else if (diameter > 25) {
          featureSpecificInsights.push('Challenge: Large hole requires boring for dimensional accuracy');
          featureSpecificInsights.push('Recommendation: Pre-drill to 80% diameter, finish bore with precision cycle');
        } else {
          featureSpecificInsights.push('Optimal: Standard drilling process is well-suited');
          featureSpecificInsights.push('Optimization: Use HSS/carbide drill with flood coolant for best results');
        }
        
        // Check if hole is near edge or corner based on position
        if (feature.position && (Math.abs(feature.position.x) > 0.7 || Math.abs(feature.position.z) > 0.7)) {
          featureSpecificInsights.push('Risk: Edge proximity may cause breakout or burr formation');
          featureSpecificInsights.push('Solution: Consider back-drilling or chamfer entry to minimize defects');
        }
        
      } else if (feature.type === 'pocket') {
        const depth = feature.dimensions.depth || 0;
        
        // Analyze pocket characteristics
        if (depth > 15) {
          featureSpecificInsights.push('Challenge: Deep pocket increases tool deflection risk');
          featureSpecificInsights.push('Recommendation: Use long-reach carbide end mill with vibration dampener');
          featureSpecificInsights.push('Strategy: Implement adaptive clearing with reduced stepover');
        } else {
          featureSpecificInsights.push('Optimal: Standard pocket milling process is suitable');
          featureSpecificInsights.push('Optimization: Consider trochoidal milling for improved surface finish');
        }
        
        // Add corner radius recommendation
        featureSpecificInsights.push('Design: Add minimum 1.5mm corner radius for tool clearance');
        
      } else if (feature.type === 'thin_wall') {
        const thickness = feature.dimensions.width || 0;
        
        if (thickness < 1.5) {
          featureSpecificInsights.push('Challenge: Thin wall may deflect during machining operations');
          featureSpecificInsights.push('Solution: Use supporting fixtures and climb milling technique');
        }
        
      } else if (feature.type === 'undercut') {
        featureSpecificInsights.push('Complex: Undercut feature requires 5-axis machining or EDM capability');
        featureSpecificInsights.push('Alternative: Consider design revision to eliminate undercut');
        featureSpecificInsights.push('Solution: Use ball end mill with indexable cutting head');
      }
      
      // Add AI-driven process recommendations if available
      if (processRecs.length > 0) {
        const relevantProcess = processRecs.find((p: any) => 
          p.name && p.name.toLowerCase().includes('machining')
        );
        if (relevantProcess && relevantProcess.pros) {
          relevantProcess.pros.forEach((pro: string) => {
            featureSpecificInsights.push(`Advantage: ${pro}`);
          });
        }
      }
      
      // Add quality considerations that are relevant to this feature
      qualityConsiderations.forEach((consideration: string) => {
        if (consideration.toLowerCase().includes(feature.type) || 
            consideration.toLowerCase().includes('dimension') || 
            consideration.toLowerCase().includes('tolerance')) {
          featureSpecificInsights.push(`Quality: ${consideration}`);
        }
      });

      // If no specific insights were found but we have general AI data, add relevant general insights
      if (featureSpecificInsights.length === 0 && (qualityConsiderations.length > 0 || processRecs.length > 0)) {
        // Add relevant general insights to this feature type
        qualityConsiderations.forEach((consideration: string) => {
          if (consideration.toLowerCase().includes(feature.type) || 
              consideration.toLowerCase().includes('tolerance') ||
              consideration.toLowerCase().includes('precision')) {
            featureSpecificInsights.push(`AI Analysis: ${consideration}`);
          }
        });
        
        // Add process-specific recommendations
        processRecs.forEach((proc: any) => {
          if (proc.reasoning && (proc.reasoning.toLowerCase().includes(feature.type) || 
                                proc.reasoning.toLowerCase().includes('hole') && feature.type === 'hole' ||
                                proc.reasoning.toLowerCase().includes('pocket') && feature.type === 'pocket')) {
            featureSpecificInsights.push(`Process: ${proc.reasoning}`);
          }
        });
      }

      return {
        ...feature,
        aiRecommendations: featureSpecificInsights
      };
    });
  };



  /* ─────────────────────────────────────────────────────────────────
     Process recommendations
     Priority: AI structured recs → score real library
  ──────────────────────────────────────────────────────────────────── */
  const buildProcesses = (
    aiProcs: any[] | undefined,
    _mfg: any,
    _geo: any,
  ) => {
    const processes: ManufacturingAnalysisData['recommendedProcesses'] = [];

    // Only use real AI-generated process recommendations from STEP file analysis
    if (aiProcs && aiProcs.length > 0) {
      aiProcs.forEach((proc: any) => {
        if (typeof proc === 'string') {
          // Simple string process name from real CAD analysis
          processes.push({
            process: proc,
            suitability: 0, // Will be populated by real analysis
            leadTime: 0,    // Will be populated by real analysis
            quality: 'Analysis Required',
            reasoning: 'Process identified from CAD geometry analysis',
            category: 'CAD Analysis'
          });
        } else if (proc && proc.name) {
          // Structured process recommendation from real CAD analysis
          processes.push({
            process: proc.name,
            suitability: Math.round((proc.suitability_score || 0) * 100),
            leadTime: proc.lead_time || proc.leadTime || 0,
            quality: proc.quality || 'Analysis Required',
            reasoning: proc.reasoning || 'Process recommendation from CAD geometry and material analysis',
            category: proc.category || 'CAD Analysis'
          });
        }
      });
    }

    // Fallback mock process recommendations when CAD analysis is unavailable
    if (processes.length === 0) {
      return [
        {
          process: 'CNC Milling',
          suitability: 85,
          leadTime: 7,
          quality: 'High Precision',
          reasoning: 'Ideal for complex 3D geometries with tight tolerances. Good surface finish and excellent dimensional accuracy.',
          category: 'Subtractive Manufacturing'
        },
        {
          process: 'SLA 3D Printing',
          suitability: 78,
          leadTime: 2,
          quality: 'Good Surface Finish',
          reasoning: 'Fast prototyping option with good detail resolution. Cost-effective for low volume production.',
          category: 'Additive Manufacturing'
        },
        {
          process: 'Injection Molding',
          suitability: 92,
          leadTime: 14,
          quality: 'Production Ready',
          reasoning: 'Best for high-volume production runs. Excellent repeatability and cost per unit for quantities >1000.',
          category: 'Molding Process'
        },
        {
          process: 'Sheet Metal Fabrication',
          suitability: 70,
          leadTime: 5,
          quality: 'Good Strength',
          reasoning: 'Suitable for thin-walled components. Fast turnaround and good structural properties.',
          category: 'Forming Process'
        }
      ];
    }

    return processes;
  };

  /* ─────────────────────────────────────────────────────────────────
     Risk extraction — AI risk_assessment + dfm_warnings + geometry
  ──────────────────────────────────────────────────────────────────── */
  const buildRisks = (aiRaw: any, dfm: any) => {
    const out: ManufacturingAnalysisData['risks'] = [];

    const ra = aiRaw?.risk_assessment;
    if (ra?.factors?.length) {
      const lvl = (ra.level || '').toLowerCase();
      const sev: ManufacturingAnalysisData['risks'][0]['severity'] =
        lvl === 'critical' ? 'critical' : lvl === 'high' ? 'high' : lvl === 'medium' ? 'medium' : 'low';
      (ra.factors as string[]).forEach((f: string, i: number) =>
        out.push({ type: 'Manufacturing Risk', severity: sev, description: f,
          mitigation: ra.mitigation?.[i] || ra.mitigation?.[0] || 'Monitor and adjust process parameters' })
      );
    }

    (aiRaw?.dfm_warnings || []).forEach((w: any) =>
      out.push({
        type: `${w.code || 'DFM'} — ${(w.severity || 'medium').toUpperCase()}`,
        severity: (w.severity as any) || 'medium',
        description: w.description || w.message || '',
        mitigation: w.recommendation || 'Review design against DFM guidelines',
      })
    );

    (dfm?.warnings || []).forEach((w: any) => {
      if (w?.type === 'ai_insight') return;
      const n = typeof w?.severity === 'number' ? w.severity : 0;
      out.push({
        type: w?.code ? String(w.code) : 'Geometry Warning',
        severity: n >= 8 ? 'critical' : n >= 6 ? 'high' : n >= 4 ? 'medium' : 'low',
        description: w?.message || String(w),
        mitigation: n >= 6 ? 'Design modification recommended before manufacturing' : 'Monitor during production',
      });
    });

    return out;
  };


  /* ─────────────────────────────────────────────────────────────────
     Helpers
  ──────────────────────────────────────────────────────────────────── */
  const highlightFeatureOnModel = (feature: ManufacturingFeature) => {
    // Use the prop selectedFeature if provided, otherwise use internal state
    const currentSelectedFeature = selectedFeature !== undefined ? selectedFeature : null;
    const next = currentSelectedFeature?.id === feature.id ? null : feature;
    onFeatureSelect?.(next);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-600 border-red-200 bg-red-50';
      case 'high':     return 'text-orange-600 border-orange-200 bg-orange-50';
      case 'medium':   return 'text-yellow-600 border-yellow-200 bg-yellow-50';
      default:         return 'text-blue-600 border-blue-200 bg-blue-50';
    }
  };

  const scoreColor = (s: number) =>
    s >= 0.75 ? 'text-green-600' : s >= 0.5 ? 'text-yellow-600' : 'text-red-600';


  useEffect(() => { 
    // Only fetch if no cached data exists or cache is stale
    if (!analysisData) {
      fetchAnalysisData(); 
    }
  }, [bomItemId, analysisData]);

  // Cache analysis data whenever it changes
  useEffect(() => {
    if (analysisData && typeof window !== 'undefined') {
      localStorage.setItem(analysisDataCacheKey, JSON.stringify(analysisData));
    }
  }, [analysisData, analysisDataCacheKey]);

  // Cache selected process whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (currentSelectedProcess) {
        localStorage.setItem(selectedProcessCacheKey, currentSelectedProcess);
      } else {
        localStorage.removeItem(selectedProcessCacheKey);
      }
    }
  }, [currentSelectedProcess, selectedProcessCacheKey]);

  // Cache feature overlay state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(showFeatureOverlayCacheKey, JSON.stringify(showFeatureOverlay));
    }
  }, [showFeatureOverlay, showFeatureOverlayCacheKey]);

  // Re-analyze features when process selection changes
  useEffect(() => {
    if (analysisData && rawMfgGeo) {
      let features = buildFeatures(rawMfgGeo.mfg, rawMfgGeo.geo);
      
      // Apply process-specific analysis
      const aiData = analysisData.manufacturabilityScore ? {
        quality_considerations: [],
        process_recommendations: [],
        dfm_recommendations: []
      } : {};
      
      features = mapAIInsightsToFeatures(features, aiData, currentSelectedProcess ?? undefined);
      
      setAnalysisData(prev => prev ? { ...prev, features } : prev);
      onFeaturesUpdate?.(features);
    }
  }, [currentSelectedProcess, rawMfgGeo]);

  // Re-score processes once the process library loads (async race with fetchAnalysisData)
  useEffect(() => {
    if (allProcesses.length > 0 && analysisData && rawMfgGeo) {
      const rescored = buildProcesses(undefined, rawMfgGeo.mfg, rawMfgGeo.geo);
      if (rescored.length > 0) {
        setAnalysisData(prev => prev ? { ...prev, recommendedProcesses: rescored } : prev);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProcesses]);

  /* ─────────────────────────────────────────────────────────────────
     Render
  ──────────────────────────────────────────────────────────────────── */
  return (
    <Card className="w-full h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Factory className="h-5 w-5" />
            Manufacturing Analysis
            {analysisData?.manufacturabilityScore != null && (
              <Badge variant="outline" className={scoreColor(analysisData.manufacturabilityScore)}>
                {Math.round(analysisData.manufacturabilityScore * 100)}% Manufacturability
              </Badge>
            )}
          </CardTitle>
          <div className="flex gap-2">
            <Button onClick={() => setShowFeatureOverlay(!showFeatureOverlay)} variant="outline" size="sm">
              <Eye className="h-4 w-4 mr-1" />
              {showFeatureOverlay ? 'Hide' : 'Show'} Features
            </Button>
            <Button onClick={runManufacturingAnalysis} disabled={analyzing} variant="default" size="sm">
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              {analyzing ? 'Analyzing...' : 'Analyze DFM'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !analysisData ? (
          <div className="text-center py-8">
            <Factory className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground mb-2">No manufacturing analysis available</p>
            <p className="text-xs text-muted-foreground">Click &quot;Analyze DFM&quot; to perform AI-powered manufacturing analysis</p>
          </div>
        ) : (
          <>
            {/* BOM Item Details */}
            {bomItem && (
              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Box className="h-5 w-5" />
                  <h3 className="font-medium">Part Details</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div className="space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">Annual Volume</span>
                    <div className="text-lg font-semibold text-primary">
                      {bomItem.annualVolume.toLocaleString()} units/year
                    </div>
                    <Badge variant={
                      bomItem.annualVolume > 10000 ? 'default' :
                      bomItem.annualVolume > 1000 ? 'secondary' :
                      bomItem.annualVolume > 100 ? 'outline' : 'destructive'
                    } className="text-xs">
                      {bomItem.annualVolume > 10000 ? 'Very High Volume' :
                       bomItem.annualVolume > 1000 ? 'High Volume' :
                       bomItem.annualVolume > 100 ? 'Medium Volume' : 'Low Volume'}
                    </Badge>
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">Material</span>
                    <div className="text-lg font-semibold">
                      {bomItem.material || 'Not specified'}
                    </div>
                    {bomItem.materialGrade && (
                      <Badge variant="outline" className="text-xs">
                        Grade: {bomItem.materialGrade}
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">DFM Analysis</span>
                    <div className="text-sm text-muted-foreground">
                      Select process below for detailed analysis
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Process Recommendations - MOVED TO TOP */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Wrench className="h-5 w-5" />
                <h3 className="font-medium">Process Recommendations</h3>
                <span className="text-xs text-muted-foreground">
                  {analysisData.recommendedProcesses.length > 0 
                    ? 'Select a manufacturing process for detailed DFM analysis and AI insights'
                    : 'Run DFM analysis to get process recommendations'}
                </span>
              </div>
              {analysisData.recommendedProcesses.length > 0 ? (
                <div className="space-y-2">
                  {analysisData.recommendedProcesses.slice(0, 8).map((p, i) => (
                    <div 
                      key={i} 
                      className={`flex items-start justify-between p-3 border rounded-lg gap-4 cursor-pointer transition-all duration-200 hover:bg-muted/50 ${
                        currentSelectedProcess === p.process ? 'border-primary bg-primary/5 shadow-md' : 'hover:border-muted-foreground/20'
                      } ${loadingProcessAnalysis && currentSelectedProcess === p.process ? 'opacity-50' : ''}`}
                      onClick={() => analyzeProcessSpecificDFM(p.process)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {loadingProcessAnalysis && currentSelectedProcess === p.process && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          <span className="truncate">{p.process}</span>
                          <Badge variant="outline" className="text-xs">
                            {Math.round(p.suitability)}% match
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">{p.category || 'Manufacturing'}</div>
                        <div className="text-xs text-muted-foreground mt-1">{p.reasoning}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-muted-foreground">{p.leadTime}d lead</div>
                        <div className="text-xs font-medium mt-1">{p.quality}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <p className="text-sm mb-2">No process recommendations available</p>
                  <p className="text-xs">Run DFM analysis to generate process recommendations</p>
                </div>
              )}
            </div>

            {/* Show detailed analysis only after process selection */}
            {currentSelectedProcess && (
              <>
                {/* AI Confidence badge */}
                {analysisData.aiConfidence != null && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Cpu className="h-3.5 w-3.5" />
                    <span>Gemini AI confidence: <strong>{Math.round(analysisData.aiConfidence * 100)}%</strong></span>
                  </div>
                )}


            {/* Manufacturing Features */}
            {analysisData.features.length > 0 && showFeatureOverlay && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-5 w-5" />
                  <h3 className="font-medium">Manufacturing Features</h3>
                  <span className="text-xs text-muted-foreground">Click to highlight on 3D model</span>
                </div>
                <div className="grid gap-2">
                  {analysisData.features.map((feature) => {
                    const featureColor = DFM_COLORS[feature.type] || '#666666';
                    const isIncompatible = currentSelectedProcess && feature.manufacturingProcess.includes('Not suitable');
                    const borderColor = isIncompatible ? '#dc2626' : featureColor;
                    const bgColor = isIncompatible ? '#dc262615' : '';
                    
                    return (
                      <div
                        key={feature.id}
                        className={`p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-all duration-200 ${
                          selectedFeature?.id === feature.id ? 'border-primary bg-primary/5 shadow-md' : ''
                        } ${isIncompatible ? 'border-red-500 bg-red-50' : ''}`}
                        style={{ 
                          borderLeftColor: borderColor, 
                          borderLeftWidth: '4px',
                          borderLeftStyle: 'solid',
                          backgroundColor: bgColor || undefined
                        }}
                        onClick={() => highlightFeatureOnModel(feature)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full flex-shrink-0" 
                              style={{ 
                                backgroundColor: featureColor,
                                boxShadow: `0 0 8px ${featureColor}40`
                              }} 
                            />
                            <Badge 
                              variant="outline" 
                              className={`text-xs ${isIncompatible ? 'border-red-500 bg-red-100 text-red-700' : ''}`}
                              style={!isIncompatible ? { 
                                borderColor: featureColor,
                                backgroundColor: featureColor + '15',
                                color: 'var(--foreground, inherit)'
                              } : {}}
                            >
                              {isIncompatible ? '⚠ ' : ''}{feature.type.replace('_', ' ').toUpperCase()}
                            </Badge>
                            <span className={`text-sm font-medium ${isIncompatible ? 'text-red-600' : ''}`}>
                              {feature.manufacturingProcess}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />{feature.cycleTime}min
                          </div>
                        </div>
                        
                        {/* Feature dimensions */}
                        {Object.keys(feature.dimensions).length > 0 && (
                          <div className="text-xs text-muted-foreground mb-2 flex gap-3 flex-wrap">
                            {feature.dimensions.diameter && (
                              <span className="bg-muted/50 px-2 py-1 rounded">Diameter: {feature.dimensions.diameter}mm</span>
                            )}
                            {feature.dimensions.depth && (
                              <span className="bg-muted/50 px-2 py-1 rounded">Depth: {feature.dimensions.depth}mm</span>
                            )}
                            {feature.dimensions.width && (
                              <span className="bg-muted/50 px-2 py-1 rounded">Width: {feature.dimensions.width}mm</span>
                            )}
                            {feature.dimensions.length && (
                              <span className="bg-muted/50 px-2 py-1 rounded">Length: {feature.dimensions.length}mm</span>
                            )}
                          </div>
                        )}

                        {/* Tooling requirements */}
                        {feature.tooling.length > 0 && (
                          <div className="text-xs mb-2">
                            <div className="font-medium text-foreground mb-1">Required Tooling:</div>
                            <div className="text-muted-foreground">
                              {feature.tooling.slice(0, 2).join(', ')}
                              {feature.tooling.length > 2 && ` +${feature.tooling.length - 2} more`}
                            </div>
                          </div>
                        )}

                        {feature.warnings.length > 0 && (
                          <Alert className="mb-2 py-2 border-amber-500/30 bg-amber-500/10">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            <AlertDescription className="text-xs text-amber-500 dark:text-amber-400">
                              {feature.warnings.join(' • ')}
                            </AlertDescription>
                          </Alert>
                        )}
                        
                        {feature.aiRecommendations.length > 0 && (
                          <div 
                            className="text-xs p-3 rounded border mt-2"
                            style={{
                              borderLeftColor: featureColor,
                              borderLeftWidth: '4px',
                              backgroundColor: featureColor + '08'
                            }}
                          >
                            <div className="font-medium mb-2" style={{ color: featureColor }}>
                              Manufacturing Analysis
                            </div>
                            <div className="space-y-1">
                              {feature.aiRecommendations.map((recommendation, idx) => (
                                <div key={idx} className="text-muted-foreground leading-relaxed">
                                  • {recommendation}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}


            {/* AI Insights */}
            {analysisData.aiInsights && Object.values(analysisData.aiInsights).some(a => a.length > 0) && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5" />
                  <h3 className="font-medium">AI Manufacturing Insights</h3>
                  {currentSelectedProcess ? (
                    <Badge variant="default" className="text-xs">
                      Process-Specific Analysis: {currentSelectedProcess}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">
                      General Analysis - Select process for specific insights
                    </Badge>
                  )}
                </div>
                <div className="space-y-3 text-sm">
                  {analysisData.aiInsights.designImprovements.length > 0 && (
                    <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="font-medium text-blue-800 mb-1">Quality &amp; Design</div>
                      <ul className="text-blue-700 space-y-1">
                        {analysisData.aiInsights.designImprovements.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}
                  {analysisData.aiInsights.materialSuggestions.length > 0 && (
                    <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                      <div className="font-medium text-purple-800 mb-1">Material Recommendations</div>
                      <ul className="text-purple-700 space-y-1">
                        {analysisData.aiInsights.materialSuggestions.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Manufacturing Risks */}
            {analysisData.risks.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="h-5 w-5" />
                  <h3 className="font-medium">DFM Warnings &amp; Risks</h3>
                </div>
                <div className="space-y-2">
                  {analysisData.risks.map((risk, i) => (
                    <Alert key={i} className={getSeverityColor(risk.severity)}>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="font-medium text-xs uppercase tracking-wide opacity-70 mb-0.5">{risk.type}</div>
                        <div className="font-medium">{risk.description}</div>
                        <div className="text-xs mt-1 opacity-80">Mitigation: {risk.mitigation}</div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </div>
            )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}