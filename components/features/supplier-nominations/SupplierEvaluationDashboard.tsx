'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    BarChart3,
    TrendingUp,
    AlertTriangle,
    ShieldCheck,
    Activity,
    DollarSign,
    Edit2,
    Save,
    X
} from 'lucide-react';
import { useSupplierNomination, useUpdateVendorEvaluation } from '@/lib/api/hooks/useSupplierNominations';
import { Recommendation, getRiskLevelColor, getRecommendationColor, type VendorEvaluation } from '@/lib/api/supplier-nominations';
import { toast } from 'sonner';

// Helper functions for score calculation with evaluation data priority
const getCostScore = (evaluation: VendorEvaluation, evaluationData?: any, realTimeCostScore?: number): number => {
    // Priority: real-time score from CostCompetencyAnalysis, then database evaluation data, then criteria scores, then fallback
    if (realTimeCostScore && realTimeCostScore > 0) {
        return realTimeCostScore;
    }

    if (evaluationData?.cost_analysis?.score) {
        return evaluationData.cost_analysis.score;
    }

    // Cost Competency is derived from cost-related criteria scores
    const costCriteria = evaluation.scores.filter(score =>
        score.criteriaId.toLowerCase().includes('cost') ||
        score.criteriaId.toLowerCase().includes('price') ||
        score.criteriaId.toLowerCase().includes('budget')
    );

    if (costCriteria.length === 0) return 0;

    const totalCostScore = costCriteria.reduce((sum, score) =>
        sum + (score.score / score.maxPossibleScore) * 100, 0
    );
    return totalCostScore / costCriteria.length;
};

const getVendorRatingScore = (evaluation: VendorEvaluation, evaluationData?: any, realTimeRatingScore?: number): number => {
    // Priority: real-time score from VendorRatingEngine, then database evaluation data, then criteria scores, then fallback
    if (realTimeRatingScore && realTimeRatingScore > 0) {
        return realTimeRatingScore;
    }

    if (evaluationData?.rating_engine?.score) {
        return evaluationData.rating_engine.score;
    }

    // Vendor Rating is derived from risk mitigation and vendor quality criteria
    const vendorCriteria = evaluation.scores.filter(score =>
        score.criteriaId.toLowerCase().includes('vendor') ||
        score.criteriaId.toLowerCase().includes('quality') ||
        score.criteriaId.toLowerCase().includes('rating')
    );

    if (vendorCriteria.length === 0) return 0;

    const totalVendorScore = vendorCriteria.reduce((sum, score) =>
        sum + (score.score / score.maxPossibleScore) * 100, 0
    );
    return totalVendorScore / vendorCriteria.length;
};

const getCapabilityScore = (evaluation: VendorEvaluation, evaluationData?: any, realTimeCapabilityScore?: number): number => {
    // Priority: real-time score from capability scoring, then database evaluation data, then criteria scores, then fallback
    if (realTimeCapabilityScore && realTimeCapabilityScore > 0) {
        return realTimeCapabilityScore;
    }

    if (evaluationData?.capability?.score) {
        return evaluationData.capability.score;
    }

    // Capability Score is derived from technical and capability criteria
    const capabilityCriteria = evaluation.scores.filter(score =>
        score.criteriaId.toLowerCase().includes('capability') ||
        score.criteriaId.toLowerCase().includes('technical') ||
        score.criteriaId.toLowerCase().includes('feasibility')
    );

    if (capabilityCriteria.length === 0) return 0;

    const totalCapabilityScore = capabilityCriteria.reduce((sum, score) =>
        sum + (score.score / score.maxPossibleScore) * 100, 0
    );
    return totalCapabilityScore / capabilityCriteria.length;
};

const calculateOverallScore = (
    evaluation: VendorEvaluation, 
    evaluationData?: any, 
    costWeight: number = 70, 
    vendorWeight: number = 20, 
    capabilityWeight: number = 10,
    realTimeCostScore?: number,
    realTimeRatingScore?: number,
    realTimeCapabilityScore?: number
): number => {
    // Priority: use overall score from database if available
    if (evaluationData?.overall_score) {
        return evaluationData.overall_score;
    }

    const costScore = getCostScore(evaluation, evaluationData, realTimeCostScore);
    const vendorScore = getVendorRatingScore(evaluation, evaluationData, realTimeRatingScore);
    const capabilityScore = getCapabilityScore(evaluation, evaluationData, realTimeCapabilityScore);

    // Convert percentages to decimals
    return (costScore * (costWeight / 100)) + (vendorScore * (vendorWeight / 100)) + (capabilityScore * (capabilityWeight / 100));
};

const calculateCostRatio = (evaluation: VendorEvaluation, evaluationData?: any): number => {
    // Priority: use cost ratio from evaluation data if available
    if (evaluationData?.cost_analysis?.details?.cost_ratio) {
        return evaluationData.cost_analysis.details.cost_ratio;
    }

    // Calculate cost ratio based on cost criteria scores
    const costScore = getCostScore(evaluation, evaluationData);
    // Convert percentage to ratio (higher score = lower cost ratio)
    return (100 - costScore) / 100 + 0.5;
};

const calculateResponseRate = (evaluation: VendorEvaluation, evaluationData?: any): string => {
    // Priority: use response rate from evaluation data if available
    if (evaluationData?.rating_engine?.details?.response_rate) {
        return evaluationData.rating_engine.details.response_rate;
    }

    const vendorScore = getVendorRatingScore(evaluation, evaluationData);
    if (vendorScore >= 80) return 'High';
    if (vendorScore >= 60) return 'Medium';
    return 'Low';
};

const calculateCompliance = (evaluation: VendorEvaluation, evaluationData?: any): number => {
    // Priority: use compliance from evaluation data if available
    if (evaluationData?.capability?.details?.compliance_percentage !== undefined) {
        return evaluationData.capability.details.compliance_percentage;
    }

    // Calculate compliance based on capability and vendor rating scores
    const capabilityScore = getCapabilityScore(evaluation, evaluationData);
    const vendorScore = getVendorRatingScore(evaluation, evaluationData);
    return (capabilityScore + vendorScore) / 2;
};

interface SupplierEvaluationDashboardProps {
    supplierId: string;
    nominationId: string;
    costScore?: number;
    ratingEngineScore?: number;
    capabilityScore?: number;
}

export function SupplierEvaluationDashboard({ 
    supplierId, 
    nominationId, 
    costScore = 0, 
    ratingEngineScore = 0, 
    capabilityScore = 0 
}: SupplierEvaluationDashboardProps) {
    const { data: nomination, isLoading } = useSupplierNomination(nominationId);
    const updateEvaluationMutation = useUpdateVendorEvaluation(nominationId);
    // const storeEvaluationMutation = useStoreEvaluationData();

    // Find the evaluation ID for this supplier
    /* const evaluationId = useMemo(() => {
        return nomination?.vendorEvaluations?.find(e => e.vendorId === supplierId)?.id;
    }, [nomination, supplierId]); */

    // Note: For now, using VendorEvaluation data directly instead of detailed evaluation sections
    const evaluationData: any = null;
    // const isEvaluationLoading = false;

    const [isEditing, setIsEditing] = useState(false);
    const [isEditingWeights, setIsEditingWeights] = useState(false);
    const [weights, setWeights] = useState({
        costWeight: 70,
        vendorWeight: 20,
        capabilityWeight: 10
    });
    const [editableData, setEditableData] = useState({
        evaluationNotes: '',
        technicalDiscussion: '',
        capabilityPercentage: 0,
        riskMitigationPercentage: 0,
        technicalFeasibilityScore: 0,
        majorNcCount: 0,
        minorNcCount: 0
    });

    const evaluation = useMemo(() => {
        if (!nomination?.vendorEvaluations) return null;
        const vendorEval = nomination.vendorEvaluations.find(e => e.vendorId === supplierId);

        // Initialize editable data from evaluation data or vendor evaluation
        if (!isEditing && (evaluationData || vendorEval)) {
            setEditableData({
                evaluationNotes: evaluationData?.overview?.evaluation_notes || '',
                technicalDiscussion: evaluationData?.technical?.discussion || '',
                capabilityPercentage: evaluationData?.cost_analysis?.score || 0,
                riskMitigationPercentage: evaluationData?.rating_engine?.score || 0,
                technicalFeasibilityScore: evaluationData?.capability?.score || 0,
                majorNcCount: evaluationData?.rating_engine?.major_nc_count || 0,
                minorNcCount: evaluationData?.rating_engine?.minor_nc_count || 0
            });
        }
        return vendorEval;
    }, [nomination, supplierId, isEditing, evaluationData]);

    const handleSave = async () => {
        if (!evaluation) return;

        try {
            await updateEvaluationMutation.mutateAsync({
                evaluationId: evaluation.id,
                data: editableData
            });
            setIsEditing(false);
            toast.success('Evaluation updated successfully');
        } catch (error) {
            toast.error('Failed to update evaluation');
            console.error('Update error:', error);
        }
    };

    const handleCancel = () => {
        if (evaluation) {
            setEditableData({
                evaluationNotes: evaluation.evaluationNotes || '',
                technicalDiscussion: evaluation.technicalDiscussion || '',
                capabilityPercentage: evaluation.capabilityPercentage || 0,
                riskMitigationPercentage: evaluation.riskMitigationPercentage || 0,
                technicalFeasibilityScore: evaluation.technicalFeasibilityScore || 0,
                majorNcCount: evaluation.majorNcCount || 0,
                minorNcCount: evaluation.minorNcCount || 0
            });
        }
        setIsEditing(false);
    };

    const handleWeightChange = (type: 'costWeight' | 'vendorWeight' | 'capabilityWeight', value: number) => {
        const newWeights = { ...weights, [type]: value };

        // Auto-adjust other weights to maintain 100% total
        const total = newWeights.costWeight + newWeights.vendorWeight + newWeights.capabilityWeight;
        if (total !== 100) {
            // Proportionally adjust the other two weights
            const remaining = 100 - value;
            const otherKeys = Object.keys(newWeights).filter(key => key !== type) as Array<keyof typeof weights>;
            const otherTotal = otherKeys.reduce((sum, key) => sum + weights[key], 0);

            if (otherTotal > 0) {
                otherKeys.forEach(key => {
                    newWeights[key] = Math.round((weights[key] / otherTotal) * remaining);
                });

                // Ensure exact 100% by adjusting the last weight
                const finalTotal = Object.values(newWeights).reduce((sum, val) => sum + val, 0);
                if (finalTotal !== 100 && otherKeys[0]) {
                    newWeights[otherKeys[0]] += (100 - finalTotal);
                }
            }
        }

        setWeights(newWeights);
    };

    const resetWeights = () => {
        setWeights({ costWeight: 70, vendorWeight: 20, capabilityWeight: 10 });
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    if (!evaluation) {
        return (
            <div className="text-center py-12 bg-gray-800 rounded-xl border border-gray-700">
                <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-white">Evaluation Data Not Found</h3>
                <p className="text-gray-400">Could not find evaluation records for this supplier.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">

            {/* Top Metrics */}
            <div className="space-y-4">
                {/* Header with Edit Weights Button */}
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-semibold text-white">Scoring Breakdown</h2>
                        {isEditingWeights && (
                            <p className="text-sm text-gray-400 mt-1">
                                Total: <span className={`font-medium ${weights.costWeight + weights.vendorWeight + weights.capabilityWeight === 100
                                    ? 'text-green-400'
                                    : 'text-yellow-400'
                                    }`}>
                                    {weights.costWeight + weights.vendorWeight + weights.capabilityWeight}%
                                </span>
                                {weights.costWeight + weights.vendorWeight + weights.capabilityWeight !== 100 && (
                                    <span className="text-yellow-400 ml-2">(Should equal 100%)</span>
                                )}
                            </p>
                        )}
                    </div>
                    {!isEditingWeights ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setIsEditingWeights(true)}
                            className="border-gray-600 text-gray-300 hover:bg-gray-700"
                        >
                            <Edit2 className="h-4 w-4 mr-2" />
                            Edit Weights
                        </Button>
                    ) : (
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={resetWeights}
                                className="border-gray-600 text-gray-300"
                            >
                                Reset
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => setIsEditingWeights(false)}
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                Done
                            </Button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <Card className="bg-gray-800 border-gray-700">
                        <CardContent className="p-6">
                            <p className="text-sm text-gray-400 font-medium">Overall Score</p>
                            <div className="flex items-baseline gap-2 mt-2">
                                <h3 className="text-3xl font-bold text-white">{calculateOverallScore(evaluation, evaluationData, weights.costWeight, weights.vendorWeight, weights.capabilityWeight, costScore, ratingEngineScore, capabilityScore).toFixed(1)}%</h3>
                                <Badge variant="outline" className="text-[10px] border-blue-500/50 text-blue-400 font-bold">
                                    RANK #{evaluationData?.final_rank || evaluation.overallRank || 1}
                                </Badge>
                            </div>
                            <Progress value={calculateOverallScore(evaluation, evaluationData, weights.costWeight, weights.vendorWeight, weights.capabilityWeight, costScore, ratingEngineScore, capabilityScore)} className="h-1.5 mt-4 bg-gray-700" />
                        </CardContent>
                    </Card>

                    <Card className="bg-gray-800 border-gray-700">
                        <CardContent className="p-6">
                            <p className="text-sm text-gray-400 font-medium mb-2">
                                Cost Competency
                                {isEditingWeights ? (
                                    <span className="inline-flex items-center ml-1">
                                        (<Input
                                            type="number"
                                            value={weights.costWeight}
                                            onChange={(e) => handleWeightChange('costWeight', parseInt(e.target.value) || 0)}
                                            className="w-12 h-6 text-xs bg-gray-700 border-gray-600 text-center p-1 mx-1"
                                            min="0"
                                            max="100"
                                        />%)
                                    </span>
                                ) : (
                                    <span>({weights.costWeight}%)</span>
                                )}
                            </p>
                            <div className="flex items-baseline gap-2 mt-2">
                                <h3 className="text-3xl font-bold text-white">{getCostScore(evaluation, evaluationData, costScore).toFixed(1)}%</h3>
                            </div>
                            <div className="flex items-center gap-1 mt-4 text-xs text-green-400">
                                <TrendingUp className="h-3 w-3" />
                                <span>Cost Analysis</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gray-800 border-gray-700">
                        <CardContent className="p-6">
                            <p className="text-sm text-gray-400 font-medium mb-2">
                                Vendor Rating
                                {isEditingWeights ? (
                                    <span className="inline-flex items-center ml-1">
                                        (<Input
                                            type="number"
                                            value={weights.vendorWeight}
                                            onChange={(e) => handleWeightChange('vendorWeight', parseInt(e.target.value) || 0)}
                                            className="w-12 h-6 text-xs bg-gray-700 border-gray-600 text-center p-1 mx-1"
                                            min="0"
                                            max="100"
                                        />%)
                                    </span>
                                ) : (
                                    <span>({weights.vendorWeight}%)</span>
                                )}
                            </p>
                            <div className="flex items-baseline gap-2 mt-2">
                                <h3 className="text-3xl font-bold text-white">{getVendorRatingScore(evaluation, evaluationData, ratingEngineScore).toFixed(1)}%</h3>
                                <Badge
                                    variant="outline"
                                    className={`text-[10px] border-${getRiskLevelColor(evaluationData?.overview?.risk_level || evaluation.riskLevel)}-500 text-${getRiskLevelColor(evaluationData?.overview?.risk_level || evaluation.riskLevel)}-400 font-bold`}
                                >
                                    {(evaluationData?.overview?.risk_level || evaluation.riskLevel).toUpperCase()}
                                </Badge>
                            </div>
                            <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
                                <span>{evaluationData?.rating_engine?.major_nc_count || evaluation.majorNcCount} Major</span>
                                <span className="text-gray-600">/</span>
                                <span>{evaluationData?.rating_engine?.minor_nc_count || evaluation.minorNcCount} Minor NCs</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="bg-gray-800 border-gray-700">
                        <CardContent className="p-6">
                            <p className="text-sm text-gray-400 font-medium mb-2">
                                Capability Score
                                {isEditingWeights ? (
                                    <span className="inline-flex items-center ml-1">
                                        (<Input
                                            type="number"
                                            value={weights.capabilityWeight}
                                            onChange={(e) => handleWeightChange('capabilityWeight', parseInt(e.target.value) || 0)}
                                            className="w-12 h-6 text-xs bg-gray-700 border-gray-600 text-center p-1 mx-1"
                                            min="0"
                                            max="100"
                                        />%)
                                    </span>
                                ) : (
                                    <span>({weights.capabilityWeight}%)</span>
                                )}
                            </p>
                            <div className="flex items-baseline gap-2 mt-2">
                                <h3 className="text-3xl font-bold text-white">{getCapabilityScore(evaluation, evaluationData, capabilityScore).toFixed(0)}/100</h3>
                            </div>
                            <div className="mt-4 flex gap-1">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div
                                        key={i}
                                        className={`h-1.5 flex-1 rounded-full ${i <= (getCapabilityScore(evaluation, evaluationData, capabilityScore) / 20) ? 'bg-purple-500' : 'bg-gray-700'}`}
                                    />
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Recommendation Panel */}
                <Card className="bg-gray-800 border-gray-700 lg:col-span-1">
                    <CardHeader>
                        <CardTitle className="text-lg text-white flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-blue-400" />
                            Final Verdict
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="p-4 bg-gray-900/50 rounded-xl border border-gray-700 text-center">
                            <p className="text-xs text-gray-500 uppercase font-black tracking-widest mb-3">Recommendation</p>
                            <Badge
                                className={`px-6 py-2 text-sm font-bold bg-${getRecommendationColor(evaluationData?.overview?.recommendation || evaluation.recommendation || Recommendation.PENDING)}-500/10 text-${getRecommendationColor(evaluationData?.overview?.recommendation || evaluation.recommendation || Recommendation.PENDING)}-400 border-${getRecommendationColor(evaluationData?.overview?.recommendation || evaluation.recommendation || Recommendation.PENDING)}-500/50`}
                                variant="outline"
                            >
                                {(evaluationData?.overview?.recommendation || evaluation.recommendation)?.toUpperCase() || 'PENDING'}
                            </Badge>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-sm font-medium text-gray-300">Category Scores</h4>
                            {evaluation.scores.slice(0, 5).map((score) => (
                                <div key={score.id} className="space-y-1.5">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-gray-400">Criteria ID: {score.criteriaId.slice(0, 8)}</span>
                                        <span className="text-white font-bold">{score.score} / {score.maxPossibleScore}</span>
                                    </div>
                                    <Progress value={(score.score / score.maxPossibleScore) * 100} className="h-1 bg-gray-700" />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* Detailed Insights */}
                <Card className="bg-gray-800 border-gray-700 lg:col-span-2">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg text-white">Evaluation Insights</CardTitle>
                            <div className="flex gap-2">
                                {isEditing ? (
                                    <>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleCancel}
                                            className="border-gray-600 text-gray-300"
                                        >
                                            <X className="h-4 w-4 mr-1" />
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            onClick={handleSave}
                                            disabled={updateEvaluationMutation.isPending}
                                            className="bg-green-600 hover:bg-green-700"
                                        >
                                            <Save className="h-4 w-4 mr-1" />
                                            Save
                                        </Button>
                                    </>
                                ) : (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setIsEditing(true)}
                                        className="border-gray-600 text-gray-300"
                                    >
                                        <Edit2 className="h-4 w-4 mr-1" />
                                        Edit
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <h5 className="text-xs font-black text-gray-500 uppercase tracking-widest">General Notes</h5>
                                {isEditing ? (
                                    <Textarea
                                        value={editableData.evaluationNotes}
                                        onChange={(e) => setEditableData({ ...editableData, evaluationNotes: e.target.value })}
                                        placeholder="Enter evaluation notes..."
                                        className="text-sm text-gray-300 bg-gray-900/30 border border-gray-700/50 min-h-[100px] resize-none"
                                    />
                                ) : (
                                    <p className="text-sm text-gray-300 bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 min-h-[100px]">
                                        {evaluationData?.overview?.evaluation_notes || 'No evaluation notes available.'}
                                    </p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <h5 className="text-xs font-black text-gray-500 uppercase tracking-widest">Technical Summary</h5>
                                {isEditing ? (
                                    <Textarea
                                        value={editableData.technicalDiscussion}
                                        onChange={(e) => setEditableData({ ...editableData, technicalDiscussion: e.target.value })}
                                        placeholder="Enter technical discussion..."
                                        className="text-sm text-gray-300 bg-gray-900/30 border border-gray-700/50 min-h-[100px] resize-none"
                                    />
                                ) : (
                                    <p className="text-sm text-gray-300 bg-gray-900/30 p-4 rounded-lg border border-gray-700/50 min-h-[100px]">
                                        {evaluationData?.technical?.discussion || 'No technical discussion available.'}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="pt-4 border-t border-gray-700 flex flex-wrap gap-4">
                            <div className="flex items-center gap-2 bg-gray-900/50 px-4 py-2 rounded-full border border-gray-700">
                                <DollarSign className="h-4 w-4 text-green-400" />
                                <span className="text-xs text-gray-300 font-medium">Cost Ratio: <span className="text-white italic">{calculateCostRatio(evaluation, evaluationData).toFixed(2)}</span></span>
                            </div>
                            <div className="flex items-center gap-2 bg-gray-900/50 px-4 py-2 rounded-full border border-gray-700">
                                <Activity className="h-4 w-4 text-blue-400" />
                                <span className="text-xs text-gray-300 font-medium">Response Rate: <span className="text-white italic">{calculateResponseRate(evaluation, evaluationData)}</span></span>
                            </div>
                            <div className="flex items-center gap-2 bg-gray-900/50 px-4 py-2 rounded-full border border-gray-700">
                                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                                <span className="text-xs text-gray-300 font-medium">Compliance: <span className="text-white italic">{calculateCompliance(evaluation, evaluationData).toFixed(0)}%</span></span>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
