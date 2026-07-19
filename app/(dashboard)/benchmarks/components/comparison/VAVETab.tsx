"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { BOMMetricEntry } from "../../types";
import { itemCost, formatPrice } from "../../utils";

interface Props {
  bomMetrics: BOMMetricEntry[];
}

interface VAVEOpportunity {
  type: string;
  priority: "High" | "Medium" | "Low";
  description: string;
  potential: string;
  action: string;
}

interface VAVEEntry {
  bom: BOMMetricEntry["bom"];
  opportunities: VAVEOpportunity[];
  costSavings: { type: string; savings: number }[];
  totalSavings: number;
  metrics: {
    totalParts: number;
    uniqueMaterials: number;
    highCostItems: number;
    makeVsBuyRatio: number;
  };
  aiInsights?: AIVAVEInsights;
}

interface AIVAVEInsights {
  specificOpportunities: {
    type: string;
    priority: "Critical" | "High" | "Medium" | "Low";
    description: string;
    costImpact: number;
    implementation: string;
    timeframe: string;
    confidence: number;
  }[];
  materialOptimization: {
    substitutions: { from: string; to: string; savings: number; reason: string }[];
    consolidations: { materials: string[]; potential: string; savings: number }[];
  };
  designOptimization: {
    partConsolidation: { parts: string[]; newDesign: string; savings: number }[];
    toleranceOptimization: { parts: string[]; suggestion: string; savings: number }[];
  };
  supplierOptimization: {
    makeVsBuyRecommendations: { part: string; current: string; recommended: string; savings: number; reason: string }[];
    supplierConsolidation: { suggestion: string; savings: number }[];
  };
  totalPotentialSavings: number;
  confidence: number;
}

// Claude API integration for VAVE insights
const analyzeVAVEWithAI = async (bomData: BOMMetricEntry): Promise<AIVAVEInsights> => {
  const bomAnalysis = {
    bomName: bomData.bom.name,
    totalParts: bomData.metrics.totalParts,
    totalCost: bomData.metrics.totalCost,
    totalWeight: bomData.metrics.totalWeight,
    makeVsBuy: bomData.metrics.makeVsBuy,
    items: (bomData.items || []).map(item => ({
      name: item.name,
      partNumber: item.partNumber,
      material: item.material,
      quantity: item.quantity,
      unitCost: item.unitCost,
      totalCost: itemCost(item),
      weight: item.weight || item.unitWeight,
      makeBuy: item.makeBuy,
      supplier: item.supplier,
      manufacturingProcess: item.manufacturingProcess,
      toleranceGrade: item.toleranceGrade,
      surfaceFinish: item.surfaceFinish,
      heatTreatment: item.heatTreatment,
    })).slice(0, 50) // Limit to avoid API payload size issues
  };

  const prompt = `Analyze this BOM for precise VAVE (Value Analysis/Value Engineering) opportunities. Focus on cost-effective, specific, actionable insights.

BOM Data: ${JSON.stringify(bomAnalysis, null, 2)}

Provide detailed analysis in this exact JSON format:
{
  "specificOpportunities": [
    {
      "type": "Specific opportunity type",
      "priority": "Critical|High|Medium|Low",
      "description": "Precise description with part numbers/materials",
      "costImpact": actual_dollar_amount,
      "implementation": "Step-by-step implementation plan",
      "timeframe": "Timeline for implementation",
      "confidence": percentage_as_number
    }
  ],
  "materialOptimization": {
    "substitutions": [
      {
        "from": "current_material",
        "to": "recommended_material", 
        "savings": dollar_amount,
        "reason": "Technical and cost justification"
      }
    ],
    "consolidations": [
      {
        "materials": ["material1", "material2"],
        "potential": "consolidated_material",
        "savings": dollar_amount
      }
    ]
  },
  "designOptimization": {
    "partConsolidation": [
      {
        "parts": ["part1", "part2"],
        "newDesign": "consolidated_part_description",
        "savings": dollar_amount
      }
    ],
    "toleranceOptimization": [
      {
        "parts": ["precision_parts"],
        "suggestion": "tolerance_relaxation_suggestion",
        "savings": dollar_amount
      }
    ]
  },
  "supplierOptimization": {
    "makeVsBuyRecommendations": [
      {
        "part": "part_name",
        "current": "make|buy",
        "recommended": "buy|make",
        "savings": dollar_amount,
        "reason": "Cost and capacity justification"
      }
    ],
    "supplierConsolidation": [
      {
        "suggestion": "consolidation_strategy",
        "savings": dollar_amount
      }
    ]
  },
  "totalPotentialSavings": total_dollar_amount,
  "confidence": overall_confidence_percentage
}

Focus on:
1. Specific part numbers and materials, not generic advice
2. Quantified cost savings based on actual BOM data
3. Manufacturing feasibility 
4. Supply chain optimization
5. Design for manufacturability improvements

Be precise, data-driven, and cost-focused.`;

  try {
    const response = await fetch('/api/vave-analysis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: prompt
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    throw new Error('No valid JSON found in response');
  } catch (error) {
    console.error('Claude API Error:', error);
    // Return fallback insights
    return {
      specificOpportunities: [{
        type: "API Analysis Unavailable",
        priority: "Medium" as const,
        description: "Unable to generate AI insights. Using rule-based analysis.",
        costImpact: 0,
        implementation: "Check API connectivity",
        timeframe: "N/A",
        confidence: 0
      }],
      materialOptimization: { substitutions: [], consolidations: [] },
      designOptimization: { partConsolidation: [], toleranceOptimization: [] },
      supplierOptimization: { makeVsBuyRecommendations: [], supplierConsolidation: [] },
      totalPotentialSavings: 0,
      confidence: 0
    };
  }
};

export function VAVETab({ bomMetrics }: Props) {
  const [aiInsights, setAiInsights] = useState<Map<string, AIVAVEInsights>>(new Map());
  const [loadingAI, setLoadingAI] = useState<Set<string>>(new Set());

  const handleAIAnalysis = async (bomData: BOMMetricEntry) => {
    setLoadingAI(prev => new Set(prev).add(bomData.bom.id));
    
    try {
      const insights = await analyzeVAVEWithAI(bomData);
      setAiInsights(prev => new Map(prev).set(bomData.bom.id, insights));
    } catch (error) {
      setAiInsights(prev => new Map(prev).set(bomData.bom.id, {
        specificOpportunities: [{
          type: "Analysis Unavailable",
          priority: "Medium" as const,
          description: "Unable to generate AI insights. Please try again.",
          costImpact: 0,
          implementation: "Check connectivity",
          timeframe: "N/A",
          confidence: 0
        }],
        materialOptimization: { substitutions: [], consolidations: [] },
        designOptimization: { partConsolidation: [], toleranceOptimization: [] },
        supplierOptimization: { makeVsBuyRecommendations: [], supplierConsolidation: [] },
        totalPotentialSavings: 0,
        confidence: 0
      }));
    } finally {
      setLoadingAI(prev => {
        const next = new Set(prev);
        next.delete(bomData.bom.id);
        return next;
      });
    }
  };

  const analyzeAllWithAI = async () => {
    // Clear any existing insights to force re-analysis
    setAiInsights(new Map());
    
    for (const bd of bomMetrics) {
      await handleAIAnalysis(bd);
    }
  };

  const vaveData: VAVEEntry[] = bomMetrics.map((bd) => {
    const items = bd.items ?? [];
    const opportunities: VAVEOpportunity[] = [];
    const costSavings: { type: string; savings: number }[] = [];

    const uniqueMaterials = new Set(items.map((i) => i.material).filter(Boolean)).size;
    const highCostItems = items.filter((i) => itemCost(i) > 1000);
    const makeItems = items.filter((i) => i.makeBuy === "make");
    const buyItems = items.filter((i) => i.makeBuy === "buy");

    if (items.length > 20) {
      opportunities.push({
        type: "Part Consolidation",
        priority: "High",
        description: `Reduce ${items.length} total parts`,
        potential: "Medium",
        action: "Review similar components for combination",
      });
      costSavings.push({ type: "Part Reduction", savings: items.length * 50 });
    }
    if (uniqueMaterials > 5) {
      opportunities.push({
        type: "Material Standardization",
        priority: "Medium",
        description: `Standardize ${uniqueMaterials} materials`,
        potential: "High",
        action: "Evaluate material substitution for volume benefits",
      });
      costSavings.push({ type: "Material Std.", savings: uniqueMaterials * 200 });
    }
    if (highCostItems.length > 0) {
      opportunities.push({
        type: "High-Cost Item Review",
        priority: "High",
        description: `${highCostItems.length} items exceed $1000`,
        potential: "High",
        action: "Investigate alternative materials or suppliers",
      });
      costSavings.push({
        type: "Cost Reduction",
        savings: highCostItems.reduce((s, i) => s + itemCost(i) * 0.1, 0),
      });
    }
    if (makeItems.length > buyItems.length * 3) {
      opportunities.push({
        type: "Make vs Buy",
        priority: "Medium",
        description: `${makeItems.length} make vs ${buyItems.length} buy parts`,
        potential: "Medium",
        action: "Evaluate outsourcing potential",
      });
      costSavings.push({
        type: "Outsourcing",
        savings: (makeItems.length - buyItems.length) * 150,
      });
    }

    const entryAiInsights = aiInsights.get(bd.bom.id);
    return {
      bom: bd.bom,
      opportunities,
      costSavings,
      totalSavings: costSavings.reduce((s, c) => s + c.savings, 0),
      metrics: {
        totalParts: items.length,
        uniqueMaterials,
        highCostItems: highCostItems.length,
        makeVsBuyRatio: makeItems.length / (buyItems.length || 1),
      },
      ...(entryAiInsights !== undefined && { aiInsights: entryAiInsights }),
    };
  });

  const totalOpportunities = vaveData.reduce((s, v) => s + v.opportunities.length, 0);
  const totalPotential = vaveData.reduce((s, v) => s + v.totalSavings, 0);
  const aiTotalSavings = vaveData.reduce((s, v) => s + (v.aiInsights?.totalPotentialSavings || 0), 0);
  const highestPriority = vaveData.reduce((max, v) =>
    v.opportunities.filter((o) => o.priority === "High").length >
    max.opportunities.filter((o) => o.priority === "High").length
      ? v
      : max
  );

  return (
    <div className="space-y-6 mt-4">
      {/* AI Analysis Header */}
      <Card className="bg-gradient-to-br from-primary/10 via-card to-card border-primary/20 shadow-glow animate-pulse-subtle">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">
                AI-Powered VAVE Analysis
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                Get precise, cost-effective optimization insights using Claude AI
              </p>
            </div>
            <Button 
              onClick={analyzeAllWithAI} 
              disabled={loadingAI.size > 0}
              className="gap-2"
            >
              {loadingAI.size > 0 ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                "Analyze with AI"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-card/50 border-primary/20 hover:border-primary/40 transition-all card-hover">
          <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Total Opportunities</h4>
          <p className="text-2xl font-bold text-primary">{totalOpportunities}</p>
          <p className="text-xs text-muted-foreground/70">Rule-based analysis</p>
        </Card>
        <Card className="p-4 bg-card/50 border-success/20 hover:border-success/40 transition-all">
          <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Rule-Based Savings</h4>
          <p className="text-2xl font-bold text-success">{formatPrice(totalPotential)}</p>
          <p className="text-xs text-success/70">Estimated potential</p>
        </Card>
        <Card className="p-4 bg-card/50 border-purple-500/20 hover:border-purple-500/40 transition-all">
          <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">AI Insights Savings</h4>
          <p className="text-2xl font-bold text-purple-400">{formatPrice(aiTotalSavings)}</p>
          <p className="text-xs text-purple-400/70">
            {aiInsights.size > 0 ? `From ${aiInsights.size} BOM(s)` : "Generate AI insights"}
          </p>
        </Card>
        <Card className="p-4 bg-card/50 border-destructive/20 hover:border-destructive/40 transition-all">
          <h4 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Highest Priority</h4>
          <p className="text-2xl font-bold text-destructive">{highestPriority.bom.name}</p>
          <p className="text-xs text-destructive/70">Most opportunities</p>
        </Card>
      </div>

      {/* Per-BOM VAVE details */}
      {vaveData.map((v) => (
        <Card key={v.bom.id} className="bg-card/30 border-border/50 backdrop-blur-sm overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>VAVE: {v.bom.name}</span>
              <div className="flex gap-2">
                <Badge variant="outline">{formatPrice(v.totalSavings)} rule-based</Badge>
                {v.aiInsights && (
                  <Badge variant="default" className="bg-purple-600">
                    {formatPrice(v.aiInsights.totalPotentialSavings)} AI insights
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAIAnalysis(bomMetrics.find(bd => bd.bom.id === v.bom.id)!)}
                  disabled={loadingAI.has(v.bom.id)}
                  className="ml-2 gap-1"
                >
                  {loadingAI.has(v.bom.id) && (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  AI Analyze
                </Button>
              </div>
            </CardTitle>
            <CardDescription>
              {v.opportunities.length} rule-based opportunities
              {v.aiInsights && ` + ${v.aiInsights.specificOpportunities.length} AI insights`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {v.opportunities.length > 0 ? (
              <div className="space-y-4">
                {/* Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-3 bg-secondary/30 rounded border border-border/50">
                  {(
                    Object.entries(v.metrics) as [string, number][]
                  ).map(([key, val]) => (
                    <div key={key} className="text-center">
                      <div className="text-lg font-bold">
                        {Number.isInteger(val) ? val : val.toFixed(1)}
                      </div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {key.replace(/([A-Z])/g, " $1").trim()}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Opportunities list */}
                <div className="space-y-3">
                  {v.opportunities.map((opp, i) => (
                    <div
                      key={i}
                      className={`p-4 rounded-lg border backdrop-blur-md transition-all ${
                        opp.priority === "High"
                          ? "bg-destructive/10 border-destructive/30 hover:bg-destructive/15"
                          : opp.priority === "Medium"
                          ? "bg-warning/10 border-warning/30 hover:bg-warning/15"
                          : "bg-primary/10 border-primary/30 hover:bg-primary/15"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{opp.type}</span>
                        </div>
                        <div className="flex gap-2">
                          <Badge
                            variant={
                              opp.priority === "High"
                                ? "destructive"
                                : opp.priority === "Medium"
                                ? "default"
                                : "secondary"
                            }
                            className="text-xs"
                          >
                            {opp.priority}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {opp.potential} Impact
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm mb-1">{opp.description}</p>
                      <p className="text-xs text-muted-foreground">
                        <strong>Action:</strong> {opp.action}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Cost savings breakdown */}
                {v.costSavings.length > 0 && (
                  <div className="p-4 bg-success/10 rounded-lg border border-success/20">
                    <h5 className="text-sm font-semibold mb-3 text-success">
                      Potential Cost Savings
                    </h5>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {v.costSavings.map((s, i) => (
                        <div key={i} className="flex justify-between">
                          <span className="text-emerald-700">{s.type}:</span>
                          <span className="font-medium text-emerald-800">
                            {formatPrice(s.savings)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t border-success/20 flex justify-between text-sm font-bold">
                      <span className="text-muted-foreground">Total Potential:</span>
                      <span className="text-success text-lg">{formatPrice(v.totalSavings)}</span>
                    </div>
                  </div>
                )}

                {/* AI Insights Section */}
                {v.aiInsights && (
                  <div className="border-t pt-4">
                    <h4 className="text-sm font-semibold mb-3">
                      Claude AI Insights ({v.aiInsights.confidence}% confidence)
                    </h4>
                    
                    {/* AI Specific Opportunities */}
                    <div className="space-y-3 mb-4">
                      {v.aiInsights.specificOpportunities.map((opp, i) => (
                        <div
                          key={i}
                          className={`p-4 rounded-lg border bg-gradient-to-br transition-all hover:scale-[1.01] duration-200 ${
                            opp.priority === "Critical"
                              ? "from-destructive/20 to-destructive/10 border-destructive/40 shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)]"
                              : opp.priority === "High"
                              ? "from-orange-500/20 to-orange-500/10 border-orange-500/40"
                              : opp.priority === "Medium"
                              ? "from-primary/20 to-primary/10 border-primary/40 shadow-glow"
                              : "from-muted/20 to-muted/10 border-border"
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <h5 className="font-medium text-sm">{opp.type}</h5>
                              <Badge 
                                variant={opp.priority === "Critical" ? "destructive" : "default"} 
                                className="text-xs mt-1"
                              >
                                {opp.priority} • {formatPrice(opp.costImpact)}
                              </Badge>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {opp.confidence}% confident
                            </Badge>
                          </div>
                          <p className="text-sm mb-2">{opp.description}</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div>
                              <strong>Implementation:</strong> {opp.implementation}
                            </div>
                            <div>
                              <strong>Timeframe:</strong> {opp.timeframe}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI Optimization Categories */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* Material Optimization */}
                      {(v.aiInsights.materialOptimization.substitutions.length > 0 || 
                        v.aiInsights.materialOptimization.consolidations.length > 0) && (
                        <div className="p-4 bg-primary/5 rounded-lg border border-primary/20 hover:border-primary/40 transition-all">
                          <h6 className="text-xs font-bold mb-3 text-primary uppercase tracking-widest">Material Optimization</h6>
                          {v.aiInsights.materialOptimization.substitutions.map((sub, i) => (
                            <div key={i} className="text-xs mb-3 p-2 bg-background/40 rounded border border-border/50">
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-foreground">{sub.from} → {sub.to}</span>
                                <span className="text-success font-bold">{formatPrice(sub.savings)}</span>
                              </div>
                              <span className="text-muted-foreground leading-relaxed">{sub.reason}</span>
                            </div>
                          ))}
                          {v.aiInsights.materialOptimization.consolidations.map((con, i) => (
                            <div key={i} className="text-xs mb-1 flex justify-between items-center p-2 bg-background/40 rounded">
                              <span className="text-muted-foreground">Consolidate: <strong className="text-foreground">{con.materials.join(", ")}</strong></span>
                              <span className="text-success font-bold">{formatPrice(con.savings)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Design Optimization */}
                      {(v.aiInsights.designOptimization.partConsolidation.length > 0 || 
                        v.aiInsights.designOptimization.toleranceOptimization.length > 0) && (
                        <div className="p-4 bg-purple-500/5 rounded-lg border border-purple-500/20 hover:border-purple-500/40 transition-all">
                          <h6 className="text-xs font-bold mb-3 text-purple-400 uppercase tracking-widest">Design Optimization</h6>
                          {v.aiInsights.designOptimization.partConsolidation.map((con, i) => (
                            <div key={i} className="text-xs mb-3 p-2 bg-background/40 rounded border border-border/50">
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-foreground">Consolidate {con.parts.length} parts</span>
                                <span className="text-success font-bold">{formatPrice(con.savings)}</span>
                              </div>
                              <span className="text-muted-foreground leading-relaxed">{con.newDesign}</span>
                            </div>
                          ))}
                          {v.aiInsights.designOptimization.toleranceOptimization.map((tol, i) => (
                            <div key={i} className="text-xs mb-1 p-2 bg-background/40 rounded border border-border/50">
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-foreground">Tolerance Refinement</span>
                                <span className="text-success font-bold">{formatPrice(tol.savings)}</span>
                              </div>
                              <span className="text-muted-foreground leading-relaxed">{tol.suggestion}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Supplier Optimization */}
                      {(v.aiInsights.supplierOptimization.makeVsBuyRecommendations.length > 0 || 
                        v.aiInsights.supplierOptimization.supplierConsolidation.length > 0) && (
                        <div className="p-4 bg-emerald-500/5 rounded-lg border border-emerald-500/20 hover:border-emerald-500/40 transition-all">
                          <h6 className="text-xs font-bold mb-3 text-emerald-400 uppercase tracking-widest">Supplier Optimization</h6>
                          {v.aiInsights.supplierOptimization.makeVsBuyRecommendations.map((rec, i) => (
                            <div key={i} className="text-xs mb-3 p-2 bg-background/40 rounded border border-border/50">
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-medium text-foreground">{rec.part}</span>
                                <span className="text-success font-bold">{formatPrice(rec.savings)}</span>
                              </div>
                              <div className="text-muted-foreground mb-1">{rec.current} → {rec.recommended}</div>
                              <span className="text-muted-foreground/80 leading-relaxed italic">{rec.reason}</span>
                            </div>
                          ))}
                          {v.aiInsights.supplierOptimization.supplierConsolidation.map((con, i) => (
                            <div key={i} className="text-xs p-2 bg-background/40 rounded">
                              <div className="flex justify-between items-center">
                                <span className="text-muted-foreground">{con.suggestion}</span>
                                <span className="text-success font-bold">{formatPrice(con.savings)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-6 p-4 bg-gradient-to-r from-primary/20 via-primary/5 to-purple-500/20 rounded-xl border border-primary/30 shadow-glow">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-sm font-bold text-primary uppercase tracking-wider">AI Total Potential Savings</span>
                          <p className="text-xs text-muted-foreground">Based on cross-module optimization</p>
                        </div>
                        <span className="text-2xl font-black text-primary">
                          {formatPrice(v.aiInsights.totalPotentialSavings)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm font-semibold">Well Optimized BOM</p>
                <p className="text-xs">No major VAVE opportunities identified</p>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}