'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Download,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Users,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useSupplierNomination,
  useSupplierNominations,
  useUpdateVendorEvaluation,
  useUpdateEvaluationScores,
  useCompleteSupplierNomination,
} from '@/lib/api/hooks/useSupplierNominations';
import { useVendors } from '@/lib/api/hooks/useVendors';
import {
  Recommendation,
  getStatusColor,
  getStatusText,
  getRiskLevelColor,
  getRecommendationColor,
  getNominationTypeLabel,
  type VendorEvaluation,
  type NominationCriteria,
} from '@/lib/api/supplier-nominations';
import {
  getCostAnalysis,
  transformCostAnalysisToComponentData,
} from '@/lib/api/cost-competency';
import {
  getVendorRatingOverallScores,
  type VendorRatingOverallScores,
} from '@/lib/api/vendor-rating-matrix';
import {
  getCapabilityScores,
} from '@/lib/api/capability-scoring';

// ---------------------------------------------------------------------------
// Score calculation helpers
// ---------------------------------------------------------------------------

const getCostScore = (
  costData: any[],
  vendorIndex: number
): number => {
  if (costData.length > 0) {
    const netPriceRow = costData.find((item: any) => item.costComponent === 'Net Price/unit');
    const developmentCostRow = costData.find((item: any) => item.costComponent === 'Development cost');
    const leadTimeRow = costData.find((item: any) => item.costComponent === 'Lead Time Days');

    if (
      netPriceRow &&
      developmentCostRow &&
      leadTimeRow &&
      vendorIndex < netPriceRow.supplierValues.length
    ) {
      const vendorNetPrice = parseFloat(netPriceRow.supplierValues[vendorIndex]) || 0;
      const baseNetPrice = parseFloat(netPriceRow.baseValue) || 0;
      const vendorDevCost = parseFloat(developmentCostRow.supplierValues[vendorIndex]) || 0;
      const baseDevCost = parseFloat(developmentCostRow.baseValue) || 0;
      const vendorLeadTime = parseFloat(leadTimeRow.supplierValues[vendorIndex]) || 0;
      const baseLeadTime = parseFloat(leadTimeRow.baseValue) || 0;

      const netPriceScore =
        baseNetPrice > 0 && vendorNetPrice > 0
          ? Math.max(0, Math.min(100, (baseNetPrice / vendorNetPrice) * 100))
          : 0;
      const devCostScore =
        baseDevCost > 0 && vendorDevCost > 0
          ? Math.max(0, Math.min(100, (baseDevCost / vendorDevCost) * 100))
          : 0;
      const leadTimeScore =
        baseLeadTime > 0 && vendorLeadTime > 0
          ? Math.max(0, Math.min(100, (baseLeadTime / vendorLeadTime) * 100))
          : 0;

      if (netPriceScore > 0 || devCostScore > 0 || leadTimeScore > 0) {
        return Math.max(
          0,
          Math.min(100, netPriceScore * 0.3333 + devCostScore * 0.3333 + leadTimeScore * 0.3334)
        );
      }
    }
  }

  // Fallback: stored score or 0 — costPercentage does not exist on VendorEvaluation
  return 0;
};

const getVendorRatingScore = (
  evaluation: VendorEvaluation,
  ratingScores: VendorRatingOverallScores | null
): number => {
  if (ratingScores && (ratingScores.sectionWiseCapability > 0 || ratingScores.riskMitigation > 0)) {
    return ratingScores.sectionWiseCapability * 0.6 + ratingScores.riskMitigation * 0.4;
  }

  if (evaluation.riskMitigationPercentage && evaluation.riskMitigationPercentage > 0) {
    return evaluation.riskMitigationPercentage;
  }

  const ratingCriteria = evaluation.scores.filter(
    (s) =>
      s.criteriaId.toLowerCase().includes('rating') ||
      s.criteriaId.toLowerCase().includes('risk') ||
      s.criteriaId.toLowerCase().includes('vendor') ||
      s.criteriaId.toLowerCase().includes('control')
  );

  if (ratingCriteria.length > 0) {
    const total = ratingCriteria.reduce(
      (sum, s) => sum + (s.score / s.maxPossibleScore) * 100,
      0
    );
    return total / ratingCriteria.length;
  }

  return 0;
};

const getCapabilityScore = (
  evaluation: VendorEvaluation,
  capabilityData: any[]
): number => {
  if (capabilityData.length > 0) {
    const totalActual = capabilityData.reduce((sum, criteria) => {
      const score = criteria.vendorScores?.[evaluation.vendorId] || 0;
      return sum + score;
    }, 0);
    const totalMax = capabilityData.reduce((sum, c) => sum + (c.maxScore || 0), 0);
    return totalMax > 0 ? (totalActual / totalMax) * 100 : 0;
  }
  return evaluation.technicalFeasibilityScore || 0;
};

const calculateOverallScore = (
  evaluation: VendorEvaluation,
  costData: any[],
  ratingScores: VendorRatingOverallScores | null,
  capabilityData: any[],
  vendorIndex: number,
  costWeight = 70,
  vendorWeight = 20,
  capabilityWeight = 10
): number => {
  const costScore = getCostScore(costData, vendorIndex);
  const vendorScore = getVendorRatingScore(evaluation, ratingScores);
  const capScore = getCapabilityScore(evaluation, capabilityData);
  return (
    costScore * (costWeight / 100) +
    vendorScore * (vendorWeight / 100) +
    capScore * (capabilityWeight / 100)
  );
};

// ---------------------------------------------------------------------------
// CircularProgress
// ---------------------------------------------------------------------------

interface CircularProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  children?: React.ReactNode;
}

function CircularProgress({
  value,
  size = 120,
  strokeWidth = 8,
  className = '',
  children,
}: CircularProgressProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (value / 100) * circumference;

  const getColor = (val: number) => {
    if (val >= 80) return '#10B981';
    if (val >= 60) return '#F59E0B';
    if (val >= 40) return '#F97316';
    return '#EF4444';
  };

  return (
    <div className={`relative ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#374151"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={getColor(value)}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? (
          <>
            <span className="text-2xl font-bold text-white">{value.toFixed(1)}%</span>
            <span className="text-xs text-gray-400">Score</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SupplierCard
// ---------------------------------------------------------------------------

interface SupplierCardProps {
  evaluation: VendorEvaluation;
  criteria: NominationCriteria[];
  vendor?: any;
  rank: number;
  vendorIndex: number;
  nominationId: string;
  onUpdate: (evaluationId: string, data: any) => void;
  onUpdateScores: (evaluationId: string, scores: any[]) => void;
  onSelectEvaluation?: (evaluationId: string) => void;
  weights: { costWeight: number; vendorWeight: number; capabilityWeight: number };
  costAnalysisData: any[];
  vendorRatingScores: VendorRatingOverallScores | null;
  capabilityData: any[];
}

function SupplierCard({
  evaluation,
  criteria,
  vendor,
  rank,
  vendorIndex,
  nominationId,
  costAnalysisData,
  vendorRatingScores,
  capabilityData,
  onSelectEvaluation,
  weights,
}: SupplierCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [lastUpdateTime, setLastUpdateTime] = useState(0);
  const [remainingCooldown, setRemainingCooldown] = useState(0);
  const updateVendorEvaluation = useUpdateVendorEvaluation(nominationId);

  const RATE_LIMIT_MS = 2000;

  useEffect(() => {
    if (lastUpdateTime === 0) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, RATE_LIMIT_MS - (Date.now() - lastUpdateTime));
      setRemainingCooldown(remaining);
      if (remaining === 0) clearInterval(interval);
    }, 100);
    return () => clearInterval(interval);
  }, [lastUpdateTime]);

  const isRateLimited = remainingCooldown > 0;

  const handleQuickApproval = async (evaluationId: string, recommendation: Recommendation) => {
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    if (timeSinceLastUpdate < RATE_LIMIT_MS) {
      const waitTime = Math.ceil((RATE_LIMIT_MS - timeSinceLastUpdate) / 1000);
      toast.error(`Please wait ${waitTime} second${waitTime > 1 ? 's' : ''} before making another request`);
      return;
    }
    if (isUpdating) {
      toast.error('Update already in progress. Please wait...');
      return;
    }

    setIsUpdating(true);
    setLastUpdateTime(Date.now());

    try {
      await updateVendorEvaluation.mutateAsync({
        evaluationId,
        data: {
          recommendation,
          evaluationNotes: `Quick ${recommendation} from nomination overview at ${new Date().toISOString()}`,
        },
      });
      toast.success(`Vendor ${recommendation} successfully`);
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.includes('rate limit') || err.message.includes('too many requests')) {
          toast.error('Rate limit exceeded. Please wait before trying again.');
        } else if (err.message.includes('network') || err.message.includes('fetch')) {
          toast.error('Network error. Please check your connection and try again.');
        } else {
          toast.error(`Failed to update vendor approval: ${err.message}`);
        }
      } else {
        toast.error('Failed to update vendor approval. Please try again.');
      }
    } finally {
      setIsUpdating(false);
    }
  };

  const getRecommendationIcon = (recommendation: Recommendation) => {
    switch (recommendation) {
      case Recommendation.APPROVED:
        return <CheckCircle className="h-4 w-4 text-green-400" />;
      case Recommendation.CONDITIONAL:
        return <AlertTriangle className="h-4 w-4 text-yellow-400" />;
      case Recommendation.REJECTED:
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Clock className="h-4 w-4 text-gray-400" />;
    }
  };

  const getRankColor = (r: number) => {
    if (r === 1) return 'text-green-400 bg-green-400/20';
    if (r === 2) return 'text-blue-400 bg-blue-400/20';
    if (r === 3) return 'text-orange-400 bg-orange-400/20';
    return 'text-gray-400 bg-gray-400/20';
  };

  const overallScore = calculateOverallScore(
    evaluation,
    costAnalysisData,
    vendorRatingScores,
    capabilityData,
    vendorIndex,
    weights.costWeight,
    weights.vendorWeight,
    weights.capabilityWeight
  );
  const costScore = getCostScore(costAnalysisData, vendorIndex);
  const vendorScore = getVendorRatingScore(evaluation, vendorRatingScores);
  const capScore = getCapabilityScore(evaluation, capabilityData);

  const cooldownSeconds = Math.ceil(remainingCooldown / 1000);

  const renderActionButton = (
    targetRecommendation: Recommendation,
    label: string,
    Icon: any,
    colorClass: string
  ) => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => handleQuickApproval(evaluation.id, targetRecommendation)}
      disabled={isUpdating || isRateLimited}
      className={`${colorClass} disabled:opacity-50 disabled:cursor-not-allowed`}
      title={isRateLimited ? `Please wait ${cooldownSeconds} seconds` : label}
    >
      {isUpdating ? (
        <>
          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-1" />
          Processing...
        </>
      ) : isRateLimited ? (
        <>
          <Clock className="h-3 w-3 mr-1" />
          Wait {cooldownSeconds}s
        </>
      ) : (
        <>
          <Icon className="h-3 w-3 mr-1" />
          {label}
        </>
      )}
    </Button>
  );

  return (
    <Card className="bg-gray-800 border-gray-700 transition-all duration-200 hover:border-gray-600">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${getRankColor(rank)}`}
            >
              {rank}
            </div>
            <div>
              <CardTitle className="text-lg text-white">
                {vendor?.name || evaluation.vendorName || 'Unknown Vendor'}
              </CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={`border-${getRecommendationColor(evaluation.recommendation || Recommendation.PENDING)}-500 text-${getRecommendationColor(evaluation.recommendation || Recommendation.PENDING)}-400`}
                >
                  {getRecommendationIcon(evaluation.recommendation || Recommendation.PENDING)}
                  <span className="ml-1">
                    {evaluation.recommendation?.replace('_', ' ').toUpperCase() || 'PENDING'}
                  </span>
                </Badge>
              </div>
            </div>
          </div>

          <CircularProgress value={overallScore} size={80} strokeWidth={6}>
            <span className="text-lg font-bold text-white">{overallScore.toFixed(0)}</span>
            <span className="text-xs text-gray-400">Score</span>
          </CircularProgress>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{costScore.toFixed(0)}%</div>
            <div className="text-xs text-gray-400">Cost Competency</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{vendorScore.toFixed(0)}%</div>
            <div className="text-xs text-gray-400">Vendor Rating</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-white">{capScore.toFixed(0)}%</div>
            <div className="text-xs text-gray-400">Capability Score</div>
          </div>
        </div>

        {/* Risk Assessment */}
        <div className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
          <div>
            <div className="text-sm font-medium text-white">Risk Level</div>
            <div className="flex items-center gap-2 mt-1">
              <Badge
                variant="outline"
                className={`border-${getRiskLevelColor(evaluation.riskLevel)}-500 text-${getRiskLevelColor(evaluation.riskLevel)}-400`}
              >
                {evaluation.riskLevel.toUpperCase()}
              </Badge>
              <span className="text-xs text-gray-400">
                NC: {evaluation.minorNcCount}M / {evaluation.majorNcCount}Mj
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="border-gray-600 text-gray-300"
            >
              {isExpanded ? 'Less' : 'Details'}
            </Button>
            {onSelectEvaluation && (
              <Button
                variant="default"
                size="sm"
                onClick={() => onSelectEvaluation(evaluation.id)}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                Evaluate
              </Button>
            )}
          </div>
        </div>

        {/* Quick Approval Actions */}
        <div className="flex items-center justify-between p-3 bg-gray-700/30 rounded-lg">
          <div className="text-sm font-medium text-white">Quick Actions:</div>
          <div className="flex gap-2">
            {evaluation.recommendation === Recommendation.APPROVED
              ? renderActionButton(
                Recommendation.REJECTED,
                'Undo Approval',
                Undo2,
                'border-orange-600 text-orange-400 hover:bg-orange-600 hover:text-white'
              )
              : evaluation.recommendation === Recommendation.REJECTED
                ? renderActionButton(
                  Recommendation.APPROVED,
                  'Approve',
                  CheckCircle,
                  'border-green-600 text-green-400 hover:bg-green-600 hover:text-white'
                )
                : (
                  <>
                    {renderActionButton(
                      Recommendation.APPROVED,
                      'Approve',
                      CheckCircle,
                      'border-green-600 text-green-400 hover:bg-green-600 hover:text-white'
                    )}
                    {renderActionButton(
                      Recommendation.REJECTED,
                      'Reject',
                      XCircle,
                      'border-red-600 text-red-400 hover:bg-red-600 hover:text-white'
                    )}
                  </>
                )}
          </div>
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="space-y-4 border-t border-gray-700 pt-4">
            <h4 className="text-sm font-medium text-white mb-3">Score Calculation Breakdown</h4>


            {/* Vendor Rating */}
            <div className="p-4 bg-gray-700/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-medium text-white">
                  Vendor Rating Analysis (20% Weight)
                </h5>
                <span className="text-lg font-bold text-white">{vendorScore.toFixed(1)}%</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Section-wise Capability:</span>
                  <span className="text-white">
                    {vendorRatingScores?.sectionWiseCapability ?? 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Risk Mitigation:</span>
                  <span className="text-white">{vendorRatingScores?.riskMitigation ?? 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Total Records:</span>
                  <span className="text-white">{vendorRatingScores?.totalRecords ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Capability Assessment */}
            <div className="p-4 bg-gray-700/30 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-medium text-white">
                  Capability Assessment (10% Weight)
                </h5>
                <span className="text-lg font-bold text-white">{capScore.toFixed(1)}%</span>
              </div>
              <div className="space-y-2 text-xs">
                {capabilityData.length > 0 ? (
                  capabilityData.map((item) => {
                    const vs = item.vendorScores?.[evaluation.vendorId] || 0;
                    const ms = item.maxScore || 0;
                    const pct = ms > 0 ? (vs / ms) * 100 : 0;
                    return (
                      <div key={item.criteriaId} className="space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-300">{item.criteriaName}:</span>
                          <span className="text-white">
                            {vs} / {ms} ({pct.toFixed(0)}%)
                          </span>
                        </div>
                        <Progress value={pct} className="h-1 bg-gray-600" />
                      </div>
                    );
                  })
                ) : (
                  <p className="text-gray-400 text-center py-2">No capability criteria available</p>
                )}
              </div>
            </div>

            {/* Final Score Calculation */}
            <div className="p-4 bg-gray-600/50 rounded-lg border border-gray-500">
              <h5 className="text-sm font-medium text-white mb-3">Final Score Calculation</h5>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-300">Cost Score × 70%:</span>
                  <span className="text-white">
                    {costScore.toFixed(1)}% × 0.7 = {(costScore * 0.7).toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Vendor Rating × 20%:</span>
                  <span className="text-white">
                    {vendorScore.toFixed(1)}% × 0.2 = {(vendorScore * 0.2).toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Capability × 10%:</span>
                  <span className="text-white">
                    {capScore.toFixed(1)}% × 0.1 = {(capScore * 0.1).toFixed(1)}
                  </span>
                </div>
                <hr className="border-gray-500" />
                <div className="flex justify-between font-medium">
                  <span className="text-white">Total Score:</span>
                  <span className="text-white text-lg">{overallScore.toFixed(1)}</span>
                </div>
              </div>
            </div>

            {/* Configured Evaluation Criteria */}
            {criteria.length > 0 && (
              <div className="p-4 bg-gray-700/20 rounded-lg">
                <h5 className="text-sm font-medium text-white mb-3">
                  Configured Evaluation Criteria
                </h5>
                <div className="space-y-2">
                  {criteria.map((criterion) => {
                    const scoreEntry = evaluation.scores.find(
                      (s) => s.criteriaId === criterion.id
                    );
                    const maxScore = scoreEntry?.maxPossibleScore ?? 100;
                    let actualScore = scoreEntry?.score ?? 0;

                    if (!scoreEntry || actualScore === 0) {
                      const name = criterion.criteriaName.toLowerCase();
                      if (
                        name.includes('material') ||
                        name.includes('cost') ||
                        name.includes('financial')
                      ) {
                        actualScore = costScore > 0 ? (costScore / 100) * maxScore : maxScore * 0.75;
                      } else if (
                        name.includes('process') ||
                        name.includes('feasibility') ||
                        name.includes('capacity') ||
                        name.includes('leadtime')
                      ) {
                        actualScore =
                          capScore > 0 ? (capScore / 100) * maxScore : maxScore * 0.8;
                      } else if (
                        name.includes('project') ||
                        name.includes('control')
                      ) {
                        actualScore =
                          vendorScore > 0 ? (vendorScore / 100) * maxScore : maxScore * 0.85;
                      } else {
                        const avg = costScore * 0.5 + capScore * 0.3 + vendorScore * 0.2;
                        actualScore = avg > 0 ? (avg / 100) * maxScore : maxScore * 0.7;
                      }
                    }

                    const percentage = maxScore > 0 ? (actualScore / maxScore) * 100 : 0;

                    return (
                      <div key={criterion.id} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-300">{criterion.criteriaName}</span>
                          <span className="text-white font-medium">
                            {actualScore.toFixed(0)} / {maxScore}
                          </span>
                        </div>
                        <Progress value={percentage} className="h-2 bg-gray-700" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Notes */}
            {evaluation.evaluationNotes && (
              <div>
                <h4 className="text-sm font-medium text-white mb-2">Evaluation Notes</h4>
                <p className="text-sm text-gray-300 p-3 bg-gray-700/50 rounded">
                  {evaluation.evaluationNotes}
                </p>
              </div>
            )}

            {/* Technical Discussion */}
            {evaluation.technicalDiscussion && (
              <div>
                <h4 className="text-sm font-medium text-white mb-2">Technical Discussion</h4>
                <p className="text-sm text-gray-300 p-3 bg-gray-700/50 rounded">
                  {evaluation.technicalDiscussion}
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// SupplierNominationPage
// ---------------------------------------------------------------------------

interface SupplierNominationPageProps {
  nominationId: string;
  projectId: string;
  onBack?: () => void;
  onSelectEvaluation?: (evaluationId: string) => void;
}

export function SupplierNominationPage({
  nominationId,
  onBack,
  onSelectEvaluation,
}: SupplierNominationPageProps) {
  const { data: nomination, isLoading, error } = useSupplierNomination(nominationId);

  const [costAnalysisData, setCostAnalysisData] = useState<any[]>([]);
  const [vendorRatingScores, setVendorRatingScores] = useState<
    Record<string, VendorRatingOverallScores>
  >({});
  const [capabilityData, setCapabilityData] = useState<any[]>([]);
  const [isLoadingScores, setIsLoadingScores] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'approved' | 'rejected'>('all');

  const vendorsQuery = useMemo(() => ({ status: 'active' as const, limit: 1000 }), []);
  const { data: vendorsResponse } = useVendors(vendorsQuery);

  const [weights] = useState({ costWeight: 70, vendorWeight: 20, capabilityWeight: 10 });

  // Fetch sibling nominations for group-level BOM — only when nomination is loaded
  useSupplierNominations(nomination?.projectId ?? '');

  const updateEvaluationMutation = useUpdateVendorEvaluation(nominationId);
  const updateScoresMutation = useUpdateEvaluationScores(nominationId);
  const completeNominationMutation = useCompleteSupplierNomination();

  const vendors = vendorsResponse?.vendors ?? [];

  // Load real-time scores for all vendors in nomination
  useEffect(() => {
    const loadAllVendorScores = async () => {
      if (!nomination?.vendorEvaluations?.length) return;
      setIsLoadingScores(true);
      try {
        const costData = await getCostAnalysis(nominationId);
        if (costData.length > 0) {
          const transformed = transformCostAnalysisToComponentData(
            costData,
            nomination.vendorEvaluations.map((v) => ({ id: v.vendorId, name: v.vendorName }))
          );
          setCostAnalysisData(transformed);
        }

        const capScores = await getCapabilityScores(nominationId);
        setCapabilityData(capScores);

        const ratingMap: Record<string, VendorRatingOverallScores> = {};
        for (const ev of nomination.vendorEvaluations) {
          try {
            ratingMap[ev.vendorId] = await getVendorRatingOverallScores(
              nominationId,
              ev.vendorId
            );
          } catch {
            ratingMap[ev.vendorId] = {
              sectionWiseCapability: 0,
              riskMitigation: 0,
              totalMinorNC: 0,
              totalMajorNC: 0,
              totalRecords: 0,
            };
          }
        }
        setVendorRatingScores(ratingMap);
      } catch (err) {
        console.error('Failed to load vendor scores:', err);
      } finally {
        setIsLoadingScores(false);
      }
    };

    loadAllVendorScores();
  }, [nominationId, nomination?.vendorEvaluations]);

  const vendorMap = useMemo(
    () => new Map(vendors.map((v) => [v.id, v])),
    [vendors]
  );

  const groupBomParts = useMemo(() => {
    if (!nomination?.bomParts) return [];
    return nomination.bomParts.map((part) => ({
      ...part,
      nominationName: nomination.nominationName,
      nominationId: nomination.id,
    }));
  }, [nomination]);

  // Pre-compute scores to avoid re-running calculateOverallScore inside sort comparator
  const evaluationsWithScores = useMemo(() => {
    if (!nomination?.vendorEvaluations) return [];
    return nomination.vendorEvaluations.map((evaluation, index) => ({
      evaluation,
      score: calculateOverallScore(
        evaluation,
        costAnalysisData,
        vendorRatingScores[evaluation.vendorId] ?? null,
        capabilityData,
        index,
        weights.costWeight,
        weights.vendorWeight,
        weights.capabilityWeight
      ),
      index,
    }));
  }, [nomination?.vendorEvaluations, costAnalysisData, vendorRatingScores, capabilityData, weights]);

  const sortedEvaluations = useMemo(() => {
    let filtered = evaluationsWithScores;
    if (statusFilter === 'approved') {
      filtered = filtered.filter((e) => e.evaluation.recommendation === 'approved');
    } else if (statusFilter === 'rejected') {
      filtered = filtered.filter((e) => e.evaluation.recommendation !== 'approved');
    }
    return [...filtered].sort((a, b) => b.score - a.score);
  }, [evaluationsWithScores, statusFilter]);

  const summaryStats = useMemo(() => {
    if (!evaluationsWithScores.length) return null;
    const total = evaluationsWithScores.length;
    const avgScore = evaluationsWithScores.reduce((s, e) => s + e.score, 0) / total;
    const approved = evaluationsWithScores.filter(
      (e) => e.evaluation.recommendation === 'approved'
    ).length;
    return { totalVendors: total, avgScore, approved, rejected: total - approved };
  }, [evaluationsWithScores]);

  const handleUpdateEvaluation = async (evaluationId: string, data: any) => {
    try {
      await updateEvaluationMutation.mutateAsync({ evaluationId, data });
    } catch (err) {
      console.error('Update evaluation error:', err);
    }
  };

  const handleUpdateScores = async (evaluationId: string, scores: any[]) => {
    try {
      await updateScoresMutation.mutateAsync({ evaluationId, scores });
    } catch (err) {
      console.error('Update scores error:', err);
    }
  };

  const handleCompleteNomination = async () => {
    if (
      !window.confirm(
        'Are you sure you want to complete this supplier nomination? This action cannot be undone.'
      )
    ) {
      return;
    }
    try {
      await completeNominationMutation.mutateAsync(nominationId);
    } catch (err) {
      console.error('Complete nomination error:', err);
    }
  };

  const handleExportResults = () => {
    toast.info('Export functionality will be available soon');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto flex items-center justify-center h-64">
          <div className="text-white">Loading nomination...</div>
        </div>
      </div>
    );
  }

  if (error || !nomination) {
    return (
      <div className="min-h-screen bg-gray-900 p-6">
        <div className="max-w-7xl mx-auto flex flex-col items-center justify-center h-64 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-red-400" />
            <div className="text-xl font-semibold text-white">Nomination Not Found</div>
          </div>
          <div className="text-gray-400 text-center max-w-md">
            The supplier nomination with ID &ldquo;{nominationId}&rdquo; could not be found.
          </div>
          {onBack && (
            <Button
              variant="outline"
              onClick={onBack}
              className="mt-4 border-gray-600 text-gray-300 hover:bg-gray-800"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Project
            </Button>
          )}
          <div className="text-sm text-gray-500 mt-2">
            Tip: Create nominations through the project dashboard with proper vendor selection.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div className="flex items-center gap-4">
            {onBack && (
              <Button
                variant="outline"
                size="sm"
                onClick={onBack}
                className="border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            )}
            <div>
              <h1 className="text-3xl font-bold text-white">{nomination.nominationName}</h1>
              <div className="flex items-center gap-4 mt-2">
                <Badge
                  variant="outline"
                  className={`border-${getStatusColor(nomination.status)}-500 text-${getStatusColor(nomination.status)}-400`}
                >
                  {getStatusText(nomination.status)}
                </Badge>
                <Badge variant="secondary">
                  {getNominationTypeLabel(nomination.nominationType)}
                </Badge>
                <span className="text-gray-400 text-sm">
                  {nomination.vendorEvaluations.length} vendors under evaluation
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportResults}
              className="border-gray-600 text-gray-300"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button
              onClick={handleCompleteNomination}
              disabled={completeNominationMutation.isPending}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Complete Nomination
            </Button>
          </div>
        </div>

        {/* BOM Details */}
        {groupBomParts.length > 0 && (
          <Card className="bg-gray-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Selected BOM Parts ({groupBomParts.length}{' '}
                {groupBomParts.length === 1 ? 'Part' : 'Parts'})
              </CardTitle>
              {nomination.evaluationGroupId && (
                <div className="text-sm text-gray-400">
                  Evaluation Group: {nomination.evaluationGroupId}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {groupBomParts.map((bomPart, index) => (
                  <div
                    key={bomPart.bomItemId}
                    className={index > 0 ? 'pt-6 border-t border-gray-700' : ''}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-white">{bomPart.bomItemName}</h3>
                        <div className="text-sm text-gray-400 mt-1">
                          From: {bomPart.nominationName}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {bomPart.vendorIds.length} vendor
                          {bomPart.vendorIds.length !== 1 ? 's' : ''} assigned
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Part #{index + 1}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          BOM Item Name
                        </label>
                        <div className="text-white font-medium">{bomPart.bomItemName}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          ID: {bomPart.bomItemId.slice(-8)}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Part Number
                        </label>
                        <div className="text-white font-medium">
                          {bomPart.partNumber || 'Not specified'}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Material
                        </label>
                        <div className="text-white font-medium">
                          {bomPart.material || 'Not specified'}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Quantity Required
                        </label>
                        <div className="text-white font-medium">
                          {bomPart.quantity.toLocaleString()} units
                        </div>
                      </div>
                    </div>

                    {bomPart.vendorIds.length > 0 && (
                      <div className="mt-3">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Assigned Vendors
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {bomPart.vendorIds.map((vendorId: string) => {
                            const v = vendorMap.get(vendorId);
                            return (
                              <Badge key={vendorId} variant="outline" className="text-xs">
                                {v?.name || `Vendor ${vendorId.slice(-4)}`}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {nomination.description && (
                <div className="mt-6 pt-6 border-t border-gray-700">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Nomination Description
                  </label>
                  <div className="text-gray-300 text-sm">{nomination.description}</div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Summary Statistics */}
        {summaryStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-white">{summaryStats.totalVendors}</div>
                <div className="text-sm text-gray-400">Total Vendors</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">
                  {summaryStats.avgScore.toFixed(1)}%
                </div>
                <div className="text-sm text-gray-400">Avg Score</div>
              </CardContent>
            </Card>
            <Card
              className={`bg-gray-800 border-gray-700 cursor-pointer transition-all hover:border-green-500 ${statusFilter === 'approved' ? 'border-green-500 bg-green-500/10' : ''
                }`}
              onClick={() => setStatusFilter(statusFilter === 'approved' ? 'all' : 'approved')}
            >
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-400">{summaryStats.approved}</div>
                <div className="text-sm text-gray-400">Approved</div>
              </CardContent>
            </Card>
            <Card
              className={`bg-gray-800 border-gray-700 cursor-pointer transition-all hover:border-red-500 ${statusFilter === 'rejected' ? 'border-red-500 bg-red-500/10' : ''
                }`}
              onClick={() => setStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')}
            >
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-red-400">{summaryStats.rejected}</div>
                <div className="text-sm text-gray-400">Not Approved</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold text-white">Supplier Evaluations</h2>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Filter by status:</span>
              <Select
                value={statusFilter}
                onValueChange={(value: 'all' | 'approved' | 'rejected') =>
                  setStatusFilter(value)
                }
              >
                <SelectTrigger className="w-40 bg-gray-800 border-gray-600 text-white">
                  <SelectValue placeholder="All Vendors" />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-600">
                  <SelectItem value="all" className="text-white hover:bg-gray-700">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-gray-400" />
                      All Vendors ({nomination.vendorEvaluations.length})
                    </div>
                  </SelectItem>
                  <SelectItem value="approved" className="text-white hover:bg-gray-700">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      Approved ({summaryStats?.approved ?? 0})
                    </div>
                  </SelectItem>
                  <SelectItem value="rejected" className="text-white hover:bg-gray-700">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      Not Approved ({summaryStats?.rejected ?? 0})
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="text-sm text-gray-400">
            Showing {sortedEvaluations.length} of {nomination.vendorEvaluations.length} vendors
          </div>
        </div>

        {/* Evaluation Cards */}
        <div>
          {sortedEvaluations.length === 0 ? (
            <Card className="bg-gray-800 border-gray-700">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Users className="h-12 w-12 text-gray-600 mb-4" />
                <h3 className="text-lg font-medium text-white mb-2">
                  {statusFilter === 'all'
                    ? 'No Vendor Evaluations'
                    : statusFilter === 'approved'
                      ? 'No Approved Vendors'
                      : 'No Vendors to Approve'}
                </h3>
                <p className="text-gray-400 max-w-md">
                  {statusFilter === 'all'
                    ? 'This nomination currently has no vendor evaluations. Vendors should be added during nomination creation.'
                    : statusFilter === 'approved'
                      ? 'No vendors have been approved yet. Use the "Approve Vendor" button to approve vendors.'
                      : 'All vendors have been approved! Great work on completing the evaluation process.'}
                </p>
                {statusFilter !== 'all' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatusFilter('all')}
                    className="mt-4 border-gray-600 text-gray-300 hover:bg-gray-700"
                  >
                    Show All Vendors
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {sortedEvaluations.map(({ evaluation, index }, displayIndex) => (
                <SupplierCard
                  key={evaluation.id}
                  evaluation={evaluation}
                  criteria={nomination.criteria}
                  vendor={vendorMap.get(evaluation.vendorId)}
                  rank={displayIndex + 1}
                  vendorIndex={index}
                  nominationId={nominationId}
                  onUpdate={handleUpdateEvaluation}
                  onUpdateScores={handleUpdateScores}
                  onSelectEvaluation={onSelectEvaluation}
                  weights={weights}
                  costAnalysisData={costAnalysisData}
                  vendorRatingScores={vendorRatingScores[evaluation.vendorId] ?? null}
                  capabilityData={capabilityData}
                />
              ))}
            </div>
          )}
        </div>

        {/* Loading indicator for background score fetch */}
        {isLoadingScores && (
          <div className="fixed bottom-4 right-4 bg-gray-800 border border-gray-600 rounded-lg px-4 py-2 flex items-center gap-2 text-sm text-gray-300">
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-400" />
            Loading vendor scores...
          </div>
        )}
      </div>
    </div>
  );
}