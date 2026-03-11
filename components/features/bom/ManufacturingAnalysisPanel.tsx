"use client";

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  DollarSign,
  Clock,
  Factory,
  Wrench,
  Target,
  TrendingUp,
  Eye,
  Cpu,
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

interface ManufacturingFeature {
  id: string;
  type: 'hole' | 'pocket' | 'slot' | 'boss' | 'rib' | 'thin_wall' | 'overhang' | 'undercut';
  position: { x: number; y: number; z: number };
  dimensions: { length?: number; width?: number; diameter?: number; depth?: number };
  manufacturingProcess: string;
  costImpact: number;
  cycleTime: number;
  tooling: string[];
  warnings: string[];
  aiRecommendations: string[];
}

interface CostBreakdown {
  material: number;
  machining: number;
  tooling: number;
  setup: number;
  postProcessing: number;
  total: number;
}

interface ManufacturingAnalysisData {
  features: ManufacturingFeature[];
  costBreakdown: CostBreakdown;
  recommendedProcesses: Array<{
    process: string;
    suitability: number;
    cost: number;
    leadTime: number;
    quality: string;
    reasoning: string;
  }>;
  aiInsights: {
    costOptimization: string[];
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
}

interface ManufacturingAnalysisPanelProps {
  bomItemId: string;
  fileUrl?: string;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  onFeaturesUpdate?: (features: ManufacturingFeature[]) => void;
}

export default function ManufacturingAnalysisPanel({
  bomItemId,
  onFeatureSelect,
  onFeaturesUpdate,
}: ManufacturingAnalysisPanelProps) {
  const [analysisData, setAnalysisData] = useState<ManufacturingAnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<ManufacturingFeature | null>(null);
  const [showFeatureOverlay, setShowFeatureOverlay] = useState(true);
  // All processes fetched from the user's process library
  const [allProcesses, setAllProcesses] = useState<Process[]>([]);

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
        console.warn('Failed to fetch processes, using AI fallbacks:', error);
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
    try {
      const result = await bomItemsApi.analyzeCAD(bomItemId, true);
      
      // Handle both success formats - check if analysis exists
      if (result?.success || result?.analysis || result) {
        await fetchAnalysisData();
      }
    } catch (error: any) {
      console.error('Manufacturing analysis failed:', error);
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

      const features             = buildFeatures(mfgRaw, geoForBuild);
      const recommendedProcesses  = buildProcesses(aiRaw?.process_recommendations, dfm?.recommendedProcesses, mfgRaw, geoForBuild);
      const aiInsights = {
        costOptimization:      (aiRaw?.cost_optimization_suggestions || []) as string[],
        designImprovements:    (aiRaw?.quality_considerations        || []) as string[],
        materialSuggestions:   (aiRaw?.material_recommendations || []).map(
          (m: any) => [m.name, m.grade ? `(${m.grade})` : '', m.reason || m.machinability_rating || '']
            .filter(Boolean).join(' — ')
        ),
        processRecommendations: (aiRaw?.process_recommendations || []).map(
          (p: any) => p.reasoning || `${p.name}: ${Math.round((p.suitability_score || 0) * 100)}% suitability`
        ),
      };
      const risks         = buildRisks(aiRaw, dfm);
      const costBreakdown = buildCosts(aiRaw, geo);

      setAnalysisData({
        features,
        costBreakdown,
        recommendedProcesses,
        aiInsights,
        risks,
        manufacturabilityScore: dfm?.manufacturabilityScore,
        aiConfidence: aiRaw?.ai_confidence,
      });
      onFeaturesUpdate?.(features);
    } catch (error: any) {
      console.error('Failed to fetch manufacturing analysis:', error);
    } finally {
      setLoading(false);
    }
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
        manufacturingProcess: d > 25 ? 'Boring' : 'Drilling',
        costImpact: Math.round(d * 50 * 83),
        cycleTime: parseFloat((0.5 + d * 0.1).toFixed(1)),
        tooling: [`HSS Drill Ø${d}mm`, 'Center drill'],
        warnings: d < 3 ? [`Small hole Ø${d}mm — micro-drilling required`] : d > 25 ? [`Large bore Ø${d}mm — boring bar required`] : [],
        aiRecommendations: d < 3 ? ['Standardise to Ø3mm for cost reduction'] : ['Use standard drill sizes per ISO 286'],
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
          manufacturingProcess: 'CNC Milling',
          costImpact: Math.round(150 * 83),
          cycleTime: parseFloat((2 + 1.5).toFixed(1)),
          tooling: ['Roughing End Mill', 'Finishing End Mill', 'Corner Radius Tool'],
          warnings: (pockets.max_depth || 0) > 15 ? [`Deep pocket ${pockets.max_depth}mm — vibration risk`] : [],
          aiRecommendations: ['Add corner radius ≥R1.5mm', 'Use adaptive milling strategy'],
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
        manufacturingProcess: wallMm < 0.8 ? 'Wire EDM' : wallMm < 1.5 ? 'High-speed Milling' : 'CNC Milling',
        costImpact: Math.round((wallMm < 1 ? 500 : 200) * 83),
        cycleTime: parseFloat((3 + 1 / Math.max(wallMm, 0.1)).toFixed(1)),
        tooling: wallMm < 1 ? ['End Mill ≤1mm', 'High-speed spindle'] : ['Standard End Mill'],
        warnings: wallMm < 0.8
          ? [`Wall ${wallMm.toFixed(2)}mm < ISO 2768 minimum 0.8mm`]
          : wallMm < 1.5
          ? [`Thin wall ${wallMm.toFixed(2)}mm — deflection risk`]
          : [],
        aiRecommendations: wallMm < 1
          ? ['Increase to ≥1.5mm or switch to additive manufacturing']
          : ['Use climb milling to reduce cutting forces'],
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
          costImpact: Math.round(500 * 83),
          cycleTime: 8,
          tooling: ['Ball End Mill', '5-axis Setup', 'Special Fixtures'],
          warnings: [`Undercut face — 5-axis or EDM required`],
          aiRecommendations: ['Redesign to eliminate undercut', 'Consider EDM as alternative'],
        });
      }
    }

    return out;
  };



  /* ─────────────────────────────────────────────────────────────────
     Process recommendations
     Priority: AI structured recs → score real library → fallback list
  ──────────────────────────────────────────────────────────────────── */
  const buildProcesses = (
    aiProcs: any[] | undefined,
    fallback: any[] | undefined,
    mfg: any,
    geo: any,
  ) => {
    const INR = 83;

    // ── Score every real process in the library against the part ───
    if (allProcesses.length > 0) {
      // Detect dominant feature type from geometry
      const holes   = (mfg?.holes?.count   || 0) as number;
      const pockets = (mfg?.pockets?.count || 0) as number;
      const thinW   = (mfg?.thin_walls != null && mfg.thin_walls < 2.0);
      const undercut = (mfg?.undercuts?.detected === true);
      const volume  = (geo?.volumeMm3 || geo?.fullAnalysis?.estimated_volume_mm3 || 500) as number;
      const cplx    = (geo?.complexityScore || geo?.fullAnalysis?.complexity_score || 5) as number;
      const bbH     = (geo?.boundingBox?.height || geo?.fullAnalysis?.bounding_box?.height || 10) as number;

      // Category → base suitability score mapping based on geometry signals
      const categoryScore = (cat?: string): number => {
        const c = (cat || '').toLowerCase();
        let score = 40; // base
        if (c.includes('machining') || c.includes('turning') || c.includes('milling') || c.includes('drilling')) {
          score = 70;
          if (holes > 0) score += 15;
          if (pockets > 0) score += 10;
          if (undercut) score -= 10;
        } else if (c.includes('sheet')) {
          score = thinW ? 72 : 40;
          if (bbH < 5) score += 15; // thin/flat part
        } else if (c.includes('casting')) {
          score = volume > 5000 ? 65 : 45;
          if (undercut) score -= 15;
        } else if (c.includes('forging')) {
          score = volume > 2000 ? 60 : 35;
        } else if (c.includes('plastic') || c.includes('rubber')) {
          score = 35;
        } else if (c.includes('assembly')) {
          score = 25;
        } else if (c.includes('post') || c.includes('processing') || c.includes('surface')) {
          score = 30;
        } else if (c.includes('additive') || c.includes('3d print')) {
          score = 55;
          if (undercut) score += 15;
        } else if (c.includes('packing') || c.includes('delivery')) {
          score = 10;
        }
        // Complexity adjustment
        score += Math.round((cplx - 5) * 1.5);
        // AI boost: if AI named this process category, bump it
        if (aiProcs) {
          const aiNames = aiProcs.map((p: any) => (p.name || '').toLowerCase());
          if (aiNames.some((n: string) => n.includes(c) || c.includes(n.split(' ')[0] || ''))) score += 12;
        }
        if (fallback) {
          const fbNames = (fallback as any[]).map((p: any) =>
            (typeof p === 'string' ? p : p.name || '').toLowerCase()
          );
          if (fbNames.some((n: string) => c.includes(n.split(' ')[0] || ''))) score += 8;
        }
        return Math.min(Math.max(score, 5), 98);
      };

      // Group by category, pick highest-score process per category
      const scored = allProcesses.map(p => ({
        proc: p,
        score: categoryScore(p.processCategory),
      }));

      // De-duplicate: keep top process per category, then sort overall
      const seen = new Set<string>();
      const deduped = scored
        .sort((a, b) => b.score - a.score)
        .filter(({ proc }) => {
          const key = proc.processCategory.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 8);

      return deduped.map(({ proc, score }) => {
        // Estimate cost from cycle time (MHR ≈ ₹1,200/hr assumed)
        const cycleMin = proc.cycleTimeMinutes || 30;
        const setupMin = proc.setupTimeMinutes || 15;
        const costEstimate = Math.round(((cycleMin + setupMin) / 60) * 1200 * INR);
        const leadTime = Math.max(1, Math.round((cycleMin * 0.01) + (score < 50 ? 5 : 2)));
        return {
          process:    proc.processName,
          category:   proc.processCategory,
          suitability: score,
          cost:        Math.max(costEstimate, 500 * INR),
          leadTime,
          quality:     score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 45 ? 'Fair' : 'Limited',
          reasoning:   aiProcs?.find((a: any) => (a.name || '').toLowerCase().includes(proc.processCategory.toLowerCase()))?.reasoning
                       || `Matched to part: ${holes > 0 ? `${holes} hole(s), ` : ''}${pockets > 0 ? `${pockets} pocket(s), ` : ''}complexity ${cplx.toFixed(1)}/10`,
        };
      });
    }

    // ── AI structured recs (no library loaded yet) ─────────────────
    if (aiProcs && aiProcs.length > 0) {
      return aiProcs.map((p: any, i: number) => ({
        process:    p.name || `Process ${i + 1}`,
        category:   p.category || '',
        suitability: Math.round((p.suitability_score || 0.5) * 100),
        cost:        Math.round((p.cost_factor || 1) * 1000 * INR),
        leadTime:    p.lead_time || p.lead_time_days || 5,
        quality:     (p.suitability_score || 0) >= 0.85 ? 'Excellent' :
                     (p.suitability_score || 0) >= 0.65 ? 'Good' : 'Fair',
        reasoning:   p.reasoning || (Array.isArray(p.pros) ? p.pros.join('; ') : '') || 'AI-matched to part geometry',
      }));
    }

    // ── Plain string list fallback ─────────────────────────────────
    if (fallback && fallback.length > 0) {
      return (fallback as any[]).map((p: any, i: number) => {
        const name = typeof p === 'string' ? p : (p.name || p.processName || `Process ${i + 1}`);
        return {
          process:    name,
          category:   '',
          suitability: 80 - i * 8,
          cost:        (1000 + i * 400) * INR,
          leadTime:    3 + i,
          quality:     i === 0 ? 'Excellent' : i === 1 ? 'Good' : 'Fair',
          reasoning:   'Recommended based on part geometry and complexity score',
        };
      });
    }
    return [];
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
     Cost breakdown — derived from AI data + real geometry
  ──────────────────────────────────────────────────────────────────── */
  const buildCosts = (aiRaw: any, geo: any): CostBreakdown => {
    const INR = 83;
    if (!aiRaw) return { material: 0, machining: 0, tooling: 0, setup: 0, postProcessing: 0, total: 0 };

    const vol      = (geo?.volumeMm3 || 0) / 1000;   // cm³
    const cplx     = geo?.complexityScore || 5;
    const topP     = aiRaw?.process_recommendations?.[0];
    const cf       = topP?.cost_factor || 1.0;
    const sth      = aiRaw?.tooling_requirements?.estimated_setup_time_hours || 2;
    const special  = aiRaw?.tooling_requirements?.special_tooling_needed ? 3 : 1;

    const material    = Math.round(vol * cf * 50 * INR);
    const machining   = Math.round(cplx * cf * 200 * INR);
    const tooling     = Math.round(special * 500 * INR);
    const setup       = Math.round(sth * 750 * INR);
    const postProcess = Math.round(material * 0.1);

    return { material, machining, tooling, setup, postProcessing: postProcess,
      total: material + machining + tooling + setup + postProcess };
  };

  /* ─────────────────────────────────────────────────────────────────
     Helpers
  ──────────────────────────────────────────────────────────────────── */
  const highlightFeatureOnModel = (feature: ManufacturingFeature) => {
    const next = selectedFeature?.id === feature.id ? null : feature;
    setSelectedFeature(next);
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

  useEffect(() => { fetchAnalysisData(); }, [bomItemId]);

  // Re-score processes once the process library loads (async race with fetchAnalysisData)
  useEffect(() => {
    if (allProcesses.length > 0 && analysisData && rawMfgGeo) {
      const rescored = buildProcesses(undefined, undefined, rawMfgGeo.mfg, rawMfgGeo.geo);
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
            {/* AI Confidence badge */}
            {analysisData.aiConfidence != null && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Cpu className="h-3.5 w-3.5" />
                <span>Gemini AI confidence: <strong>{Math.round(analysisData.aiConfidence * 100)}%</strong></span>
              </div>
            )}

            {/* Cost Breakdown */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="h-5 w-5" />
                <h3 className="font-medium">Cost Analysis</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Material:</span>
                    <span className="font-medium">₹{analysisData.costBreakdown.material.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Machining:</span>
                    <span className="font-medium">₹{analysisData.costBreakdown.machining.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tooling:</span>
                    <span className="font-medium">₹{analysisData.costBreakdown.tooling.toLocaleString()}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Setup:</span>
                    <span className="font-medium">₹{analysisData.costBreakdown.setup.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Post-Process:</span>
                    <span className="font-medium">₹{analysisData.costBreakdown.postProcessing.toLocaleString()}</span>
                  </div>
                  <Separator className="my-1" />
                  <div className="flex justify-between font-semibold">
                    <span>Total Cost:</span>
                    <span className="text-green-600">₹{analysisData.costBreakdown.total.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

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
                    return (
                      <div
                        key={feature.id}
                        className={`p-3 border rounded-lg cursor-pointer hover:bg-muted/50 transition-all duration-200 ${
                          selectedFeature?.id === feature.id ? 'border-primary bg-primary/5 shadow-md' : ''
                        }`}
                        style={{ 
                          borderLeftColor: featureColor, 
                          borderLeftWidth: '4px',
                          borderLeftStyle: 'solid'
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
                              className="text-xs"
                              style={{ 
                                borderColor: featureColor,
                                backgroundColor: featureColor + '15',
                                color: 'var(--foreground, inherit)'
                              }}
                            >
                              {feature.type.replace('_', ' ').toUpperCase()}
                            </Badge>
                            <span className="text-sm font-medium">{feature.manufacturingProcess}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />{feature.cycleTime}min
                            <DollarSign className="h-3 w-3" />₹{feature.costImpact.toLocaleString()}
                          </div>
                        </div>
                        
                        {/* Feature dimensions */}
                        {Object.keys(feature.dimensions).length > 0 && (
                          <div className="text-xs text-muted-foreground mb-2 flex gap-2 flex-wrap">
                            {feature.dimensions.diameter && (
                              <span>⌀{feature.dimensions.diameter}mm</span>
                            )}
                            {feature.dimensions.depth && (
                              <span>↕{feature.dimensions.depth}mm deep</span>
                            )}
                            {feature.dimensions.width && (
                              <span>→{feature.dimensions.width}mm wide</span>
                            )}
                            {feature.dimensions.length && (
                              <span>↔{feature.dimensions.length}mm long</span>
                            )}
                          </div>
                        )}

                        {/* Tooling requirements */}
                        {feature.tooling.length > 0 && (
                          <div className="text-xs text-muted-foreground mb-2">
                            <span className="font-medium text-foreground">Tools:</span> {feature.tooling.slice(0, 2).join(', ')}
                            {feature.tooling.length > 2 && ` +${feature.tooling.length - 2} more`}
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
                            className="text-xs p-2 rounded border-l-4 mt-2"
                            style={{
                              borderLeftColor: featureColor,
                              backgroundColor: featureColor + '15'
                            }}
                          >
                            <span className="font-medium" style={{ color: featureColor }}>AI Insight:</span>
                            <span className="ml-1 text-muted-foreground">{feature.aiRecommendations.join(' • ')}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Process Recommendations */}
            {analysisData.recommendedProcesses.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <Wrench className="h-5 w-5" />
                  <h3 className="font-medium">Process Recommendations</h3>
                  <span className="text-xs text-muted-foreground">
                    {allProcesses.length > 0
                      ? `From your library (${allProcesses.length} processes), ranked by AI`
                      : 'From your process library, ranked by AI'}
                  </span>
                </div>
                <div className="space-y-2">
                  {analysisData.recommendedProcesses.slice(0, 8).map((p, i) => (
                    <div key={i} className="flex items-start justify-between p-3 border rounded-lg gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {p.process}
                          <Badge
                            variant={p.suitability >= 80 ? 'default' : p.suitability >= 60 ? 'secondary' : 'outline'}
                            className="text-xs"
                          >
                            {p.suitability}% match
                          </Badge>
                          {(p as any).category && (
                            <span className="text-[10px] text-muted-foreground border rounded px-1">
                              {(p as any).category}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{p.reasoning}</div>
                      </div>
                      <div className="text-right text-sm shrink-0">
                        <div className="font-medium">₹{p.cost.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">{p.leadTime}d lead</div>
                        <Badge variant={p.quality === 'Excellent' ? 'default' : p.quality === 'Good' ? 'secondary' : 'outline'} className="text-xs">
                          {p.quality}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Insights */}
            {analysisData.aiInsights && Object.values(analysisData.aiInsights).some(a => a.length > 0) && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-5 w-5" />
                  <h3 className="font-medium">AI Manufacturing Insights</h3>
                </div>
                <div className="space-y-3 text-sm">
                  {analysisData.aiInsights.costOptimization.length > 0 && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                      <div className="font-medium text-green-800 mb-1">Cost Optimization</div>
                      <ul className="text-green-700 space-y-1">
                        {analysisData.aiInsights.costOptimization.map((s, i) => <li key={i}>• {s}</li>)}
                      </ul>
                    </div>
                  )}
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
      </CardContent>
    </Card>
  );
}