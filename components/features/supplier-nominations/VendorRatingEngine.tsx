'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Calculator,
  Edit,
  Save,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getVendorRatingMatrix,
  initializeVendorRatingMatrix,
  batchUpdateVendorRatingMatrix,
  getVendorRatingOverallScores,
  type VendorRatingMatrix,
  type UpdateVendorRatingData,
  type VendorRatingOverallScores
} from '@/lib/api/vendor-rating-matrix';

interface VendorRatingEngineProps {
  vendorId: string;
  vendorName?: string;
  nominationId?: string;
  onScoreUpdate?: (scores: any[]) => void;
}

export function VendorRatingEngine({ vendorId, vendorName, nominationId, onScoreUpdate }: VendorRatingEngineProps) {
  const [ratingData, setRatingData] = useState<VendorRatingMatrix[]>([]);
  const [overallScores, setOverallScores] = useState<VendorRatingOverallScores>({
    sectionWiseCapability: 0,
    riskMitigation: 0,
    totalMinorNC: 0,
    totalMajorNC: 0,
    totalRecords: 0
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingValues, setEditingValues] = useState<Record<string, Partial<UpdateVendorRatingData>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);

  // ENTERPRISE OPTIMIZATION: Load data on mount with request deduplication and timeout safety
  useEffect(() => {
    if (!nominationId || !vendorId) {
      return;
    }
    
    let isMounted = true;
    const safetyTimeoutId = setTimeout(() => {
      if (isMounted && isLoading) {
        setIsLoading(false);
      }
    }, 8000); // 8 second safety timeout to prevent infinite spinner

    const loadData = async () => {
      setIsLoading(true);
      try {
        // BATCH LOAD: Get matrix data and scores concurrently to minimize latency
        let [matrix, scores] = await Promise.all([
          getVendorRatingMatrix(nominationId, vendorId).catch(() => []),
          getVendorRatingOverallScores(nominationId, vendorId).catch(() => ({
            sectionWiseCapability: 0,
            riskMitigation: 0,
            totalMinorNC: 0,
            totalMajorNC: 0,
            totalRecords: 0
          }))
        ]);
        
        // If no data exists, try to initialize it
        if (!matrix || matrix.length === 0) {
          try {
            const initData = await initializeVendorRatingMatrix(nominationId, vendorId);
            if (Array.isArray(initData) && initData.length > 0) {
              matrix = initData;
            } else {
              matrix = await getVendorRatingMatrix(nominationId, vendorId).catch(() => []);
            }
            // Re-fetch scores after initialization
            scores = await getVendorRatingOverallScores(nominationId, vendorId).catch(() => scores);
          } catch (initError) {
            // Continue with empty data - user will see "no data available"
          }
        }
        
        if (isMounted) {
          setRatingData(matrix || []);
          setOverallScores(scores);
        }
      } catch (error) {
        if (!isMounted) return;
        // Handle different error types professionally
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (errorMessage.includes('404') || errorMessage.includes('not found')) {
          // 404 is expected when no data exists yet - don't show error toast
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          toast.error('Network connection failed. Please check your connection and try again.');
        } else if (errorMessage.includes('timeout')) {
          toast.error('Request timed out. Please try again.');
        } else if (errorMessage.includes('500')) {
          toast.error('Server error. Please contact support if this persists.');
        } else if (errorMessage.includes('403') || errorMessage.includes('401')) {
          toast.error('Access denied. Please refresh the page and sign in again.');
        } else if (errorMessage.includes('Missing required parameters')) {
          toast.error('Invalid page parameters. Please refresh and try again.');
        } else {
          toast.error('Failed to load rating data. Please refresh the page.');
        }
        
        // Always set empty data to prevent UI breaking
        setRatingData([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
          clearTimeout(safetyTimeoutId);
        }
      }
    };
    
    loadData();

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeoutId);
    };
  }, [nominationId, vendorId]);

  // Enterprise debouncing for optimal performance
  const debouncedFieldUpdates = useRef<Record<string, NodeJS.Timeout>>({});

  // Cleanup debounced timeouts on unmount
  useEffect(() => {
    return () => {
      // Clear field update timeouts
      Object.values(debouncedFieldUpdates.current).forEach(timeout => {
        clearTimeout(timeout);
      });
    };
  }, []);
  
  // Handle field updates with proper validation and debouncing
  const handleFieldChange = (id: string, field: keyof UpdateVendorRatingData, value: number) => {
    // Validate ranges based on field type
    let validatedValue = value;
    
    if (field === 'sectionWiseCapabilityPercent' || field === 'riskMitigationPercent') {
      // Percentage fields: 0-100
      validatedValue = Math.max(0, Math.min(100, value));
    } else if (field === 'minorNC' || field === 'majorNC') {
      // NC fields: 0-999
      validatedValue = Math.max(0, Math.min(999, Math.floor(value)));
    }
    
    // Clear existing timeout for this field to prevent duplicate updates
    const fieldKey = `${id}-${field}`;
    if (debouncedFieldUpdates.current[fieldKey]) {
      clearTimeout(debouncedFieldUpdates.current[fieldKey]);
    }
    
    // Indicate pending changes for manual save
    setHasPendingChanges(true);
    
    // Debounce state updates to reduce re-renders (300ms industry standard)
    debouncedFieldUpdates.current[fieldKey] = setTimeout(() => {
      setEditingValues(prev => ({
        ...prev,
        [id]: {
          ...prev[id],
          id,
          [field]: validatedValue
        }
      }));
      
      // Clean up the timeout reference
      delete debouncedFieldUpdates.current[fieldKey];
    }, 300);
  };

  // Calculate real-time overall scores based on current editing state
  const calculateCurrentOverallScores = () => {
    // Only calculate if we have real API data
    if (!ratingData || ratingData.length === 0) {
      return {
        sectionWiseCapability: 0,
        riskMitigation: 0,
        totalMinorNC: 0,
        totalMajorNC: 0,
        totalRecords: 0
      };
    }

    let totalSectionCapability = 0;
    let totalRiskMitigation = 0;
    let totalMinorNC = 0;
    let totalMajorNC = 0;
    let recordCount = 0;

    ratingData.forEach(item => {
      const editing = editingValues[item.id];
      
      // Use edited values if available, otherwise use original values
      const sectionCapability = editing?.sectionWiseCapabilityPercent ?? (item.sectionWiseCapabilityPercent || 0);
      const riskMitigation = editing?.riskMitigationPercent ?? (item.riskMitigationPercent || 0);
      const minorNC = editing?.minorNC ?? (item.minorNC || 0);
      const majorNC = editing?.majorNC ?? (item.majorNC || 0);

      totalSectionCapability += sectionCapability;
      totalRiskMitigation += riskMitigation;
      totalMinorNC += minorNC;
      totalMajorNC += majorNC;
      recordCount++;
    });

    return {
      sectionWiseCapability: recordCount > 0 ? totalSectionCapability / recordCount : 0,
      riskMitigation: recordCount > 0 ? totalRiskMitigation / recordCount : 0,
      totalMinorNC,
      totalMajorNC,
      totalRecords: recordCount
    };
  };

  // Get current overall scores (real-time calculated or saved)
  const getCurrentOverallScores = () => {
    return isEditing ? calculateCurrentOverallScores() : overallScores;
  };

const handleSave = async () => {
    // Ensure both IDs are present before attempting to save
    if (!nominationId || !vendorId) {
      toast.error("Cannot save: Missing nomination or vendor information");
      return;
    }

    setIsSaving(true);
    let updates: UpdateVendorRatingData[] = [];
    
    try {
      // Only allow editing of numeric values, not criteria names (assessmentAspects)
      updates = Object.values(editingValues).filter(update => 
        update.sectionWiseCapabilityPercent !== undefined ||
        update.riskMitigationPercent !== undefined ||
        update.minorNC !== undefined ||
        update.majorNC !== undefined
      ) as UpdateVendorRatingData[];
      
      if (updates.length === 0) {
        toast.info('No changes to save');
        setIsEditing(false);
        setIsSaving(false);
        return;
      }

      // Save to backend with proper error handling
      try {
        
        const saveResult = await batchUpdateVendorRatingMatrix(nominationId, vendorId, updates);

// Add a small delay to allow database triggers to complete
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Refresh data from backend with retry logic
        let freshData, updatedScores;
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
          try {
            [freshData, updatedScores] = await Promise.all([
              getVendorRatingMatrix(nominationId, vendorId),
              getVendorRatingOverallScores(nominationId, vendorId)
            ]);

// Verify that scores have been calculated
            if (updatedScores && (updatedScores.sectionWiseCapability > 0 || updatedScores.riskMitigation > 0 || attempts === maxAttempts - 1)) {
              
              break;
            } else {
              
            }
            
            // Wait a bit longer and try again
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
          } catch (error) {
            
            if (attempts === maxAttempts - 1) throw error;
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // Update state with fresh data
        setRatingData(freshData || []);
        
        // If backend scores are still 0 but we have data, calculate manually
        let finalScores = updatedScores;
        if (freshData && freshData.length > 0 && (!updatedScores || 
            (updatedScores.sectionWiseCapability === 0 && updatedScores.riskMitigation === 0))) {
          
          let totalSectionCapability = 0;
          let totalRiskMitigation = 0;
          let totalMinorNC = 0;
          let totalMajorNC = 0;
          let recordCount = 0;
          
          freshData.forEach(item => {
            totalSectionCapability += item.sectionWiseCapabilityPercent || 0;
            totalRiskMitigation += item.riskMitigationPercent || 0;
            totalMinorNC += item.minorNC || 0;
            totalMajorNC += item.majorNC || 0;
            recordCount++;
          });
          
          finalScores = {
            sectionWiseCapability: recordCount > 0 ? totalSectionCapability / recordCount : 0,
            riskMitigation: recordCount > 0 ? totalRiskMitigation / recordCount : 0,
            totalMinorNC,
            totalMajorNC,
            totalRecords: recordCount
          };

}
        
        setOverallScores(finalScores || {
          sectionWiseCapability: 0,
          riskMitigation: 0,
          totalMinorNC: 0,
          totalMajorNC: 0,
          totalRecords: 0
        });
        
        setEditingValues({});
        setIsEditing(false);
        
        if (onScoreUpdate) {
          onScoreUpdate(freshData);
        }
        
        toast.success(`Successfully updated ${updates.length} rating entries`);
        
        // If scores are still 0 after all attempts, force a page refresh as fallback
        if (finalScores && finalScores.sectionWiseCapability === 0 && finalScores.riskMitigation === 0) {
          const hasNonZeroValues = freshData?.some(item => 
            (item.sectionWiseCapabilityPercent && item.sectionWiseCapabilityPercent > 0) ||
            (item.riskMitigationPercent && item.riskMitigationPercent > 0)
          );
          
          if (hasNonZeroValues) {
            toast.info('Refreshing page to ensure latest scores are displayed...');
            setTimeout(() => window.location.reload(), 2000);
          }
        }
        
        // Clear pending changes after successful save
        setHasPendingChanges(false);
      } catch (error) {
        toast.error('Failed to save ratings. Please try again.');
      }
      
      setIsSaving(false);
      return;
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to save: ${errorMessage}`);
      
    } finally {
      setIsSaving(false);
    }
  };

  // Cancel editing
  const handleCancel = () => {
    setEditingValues({});
    setIsEditing(false);
  };

  // Get current value (edited or original) with safe fallbacks
  const getCurrentValue = (item: VendorRatingMatrix, field: keyof UpdateVendorRatingData): number => {
    const edited = editingValues[item.id];
    if (edited && edited[field] !== undefined) {
      return edited[field] as number;
    }
    
    switch (field) {
      case 'sectionWiseCapabilityPercent': return item.sectionWiseCapabilityPercent || 0;
      case 'riskMitigationPercent': return item.riskMitigationPercent || 0;
      case 'minorNC': return item.minorNC || 0;
      case 'majorNC': return item.majorNC || 0;
      default: return 0;
    }
  };

  // Safe display value with fallback
  const getDisplayValue = (value: number | undefined): string => {
    return value !== undefined ? value.toFixed(1) : '0.0';
  };

  // Group data by category
  const groupedData = ratingData.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, VendorRatingMatrix[]>);

  // Remove loading state to show data immediately and prevent duplicate requests

  return (
    <div className="space-y-6">
      {/* Header with Overall Scores */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="text-sm text-gray-400">Overall Score 1</div>
            <div className="text-2xl font-bold text-white">{getDisplayValue(getCurrentOverallScores().sectionWiseCapability)}%</div>
            <div className="text-xs text-gray-400">Section Capability</div>
          </CardContent>
        </Card>
        
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="text-sm text-gray-400">Overall Score 2</div>
            <div className="text-2xl font-bold text-white">{getDisplayValue(getCurrentOverallScores().riskMitigation)}%</div>
            <div className="text-xs text-gray-400">Risk Mitigation</div>
          </CardContent>
        </Card>
        
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="text-sm text-gray-400">Non-Conformities</div>
            <div className="flex gap-2 mt-1">
              <Badge className="bg-green-500/20 text-green-400">Minor: {getCurrentOverallScores().totalMinorNC}</Badge>
              <Badge className="bg-red-500/20 text-red-400">Major: {getCurrentOverallScores().totalMajorNC}</Badge>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gray-800 border-gray-700">
          <CardContent className="p-4">
            <div className="text-sm text-gray-400">Rating Status</div>
            <div className="text-lg font-bold text-white">{overallScores.totalRecords} criteria loaded</div>
            
            {!isEditing ? (
              <div className="flex items-center gap-2 mt-2">
                <Button
                  onClick={() => setIsEditing(!isEditing)}
                  disabled={isSaving}
                  variant="default"
                  size="sm"
                  className="flex items-center gap-2"
                >
                  <Edit className="h-4 w-4" />
                  Edit Assessment
                </Button>
              </div>
            ) : (
              <div className="mt-3">
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant="secondary" className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                    {Object.keys(editingValues).length} unsaved changes
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleCancel}
                    variant="outline"
                    disabled={isSaving}
                    size="sm"
                    className="border-gray-600 text-gray-400 hover:text-white"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={isSaving || Object.keys(editingValues).length === 0}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <Save className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vendor Rating Header with Overall Scores */}
      <Card className="bg-gray-800 border-gray-700">
        <CardContent className="p-6">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-white">
                {vendorName || 'Vendor Rating Assessment'}
              </h2>
              <p className="text-gray-400 mt-1">Rating Matrix Evaluation</p>
            </div>
            
            <div className="text-right">
              <div className="text-3xl font-bold text-white">
                {(() => {
                  // Calculate combined overall score from all metrics
                  const sectionCapability = overallScores.sectionWiseCapability || 0;
                  const riskMitigation = overallScores.riskMitigation || 0;
                  
                  // Weighted average: 60% capability + 40% risk mitigation
                  const overallScore = (sectionCapability * 0.6) + (riskMitigation * 0.4);
                  return overallScore.toFixed(1);
                })()}%
              </div>
              <div className="text-sm text-gray-400">Overall Score</div>
              
              <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
                <div className="text-center">
                  <div className="text-lg font-semibold text-blue-400">
                    {overallScores.riskMitigation.toFixed(1)}%
                  </div>
                  <div className="text-gray-400">Risk Mitigation</div>
                </div>
                
                <div className="text-center">
                  <div className="text-lg font-semibold text-orange-400">
                    {overallScores.totalMinorNC + overallScores.totalMajorNC}
                  </div>
                  <div className="text-gray-400">Total NCs</div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vendor Rating Assessment Matrix */}
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Vendor Rating Assessment Matrix
            </div>
            {hasPendingChanges && (
              <div className="flex items-center gap-2 text-amber-300 text-sm">
                <div className="w-2 h-2 bg-amber-300 rounded-full animate-pulse"></div>
                Unsaved changes
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!ratingData || ratingData.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center text-gray-400">
                {isLoading ? 'Loading rating matrix...' : 'No rating data available'}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="p-3 text-center bg-blue-100 text-black font-medium">S.no</th>
                    <th className="p-3 text-center bg-blue-100 text-black font-medium">Category</th>
                    <th className="p-3 text-center bg-blue-100 text-black font-medium">Assessment Aspects</th>
                    <th className="p-3 text-center bg-blue-100 text-black font-medium">Section wise Capability %</th>
                    <th className="p-3 text-center bg-blue-100 text-black font-medium">Risk Mitigation %</th>
                    <th className="p-3 text-center bg-blue-100 text-black font-medium">No of Minor NC</th>
                    <th className="p-3 text-center bg-blue-100 text-black font-medium">No of Major NC</th>
                  </tr>
                </thead>
                <tbody>
                  {ratingData
                    .sort((a, b) => (a.sortOrder || a.sNo || 0) - (b.sortOrder || b.sNo || 0))
                    .map((item) => (
                      <tr key={`row-${item.id}`} className="border-b border-gray-700">
                        <td className="p-3 text-gray-300 text-center">{item.sNo}</td>
                        <td className="p-3 text-gray-300 text-center">{item.category}</td>
                        <td className="p-3 text-gray-300">{item.assessmentAspects}</td>
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              value={getCurrentValue(item, 'sectionWiseCapabilityPercent')}
                              onChange={(e) => handleFieldChange(item.id, 'sectionWiseCapabilityPercent', parseFloat(e.target.value) || 0)}
                              className="w-20 h-8 text-center bg-gray-700 border border-gray-600 text-white rounded px-2"
                            />
                          ) : (
                            <span className="text-gray-300">{getDisplayValue(item.sectionWiseCapabilityPercent)}%</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              value={getCurrentValue(item, 'riskMitigationPercent')}
                              onChange={(e) => handleFieldChange(item.id, 'riskMitigationPercent', parseFloat(e.target.value) || 0)}
                              className="w-20 h-8 text-center bg-gray-700 border border-gray-600 text-white rounded px-2"
                            />
                          ) : (
                            <span className="text-gray-300">{getDisplayValue(item.riskMitigationPercent)}%</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="999"
                              step="1"
                              value={getCurrentValue(item, 'minorNC')}
                              onChange={(e) => handleFieldChange(item.id, 'minorNC', parseInt(e.target.value) || 0)}
                              className="w-16 h-8 text-center bg-gray-700 border border-gray-600 text-white rounded px-2"
                            />
                          ) : (
                            <span className="text-gray-300">{item.minorNC || 0}</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              max="999"
                              step="1"
                              value={getCurrentValue(item, 'majorNC')}
                              onChange={(e) => handleFieldChange(item.id, 'majorNC', parseInt(e.target.value) || 0)}
                              className="w-16 h-8 text-center bg-gray-700 border border-gray-600 text-white rounded px-2"
                            />
                          ) : (
                            <span className="text-gray-300">{item.majorNC || 0}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  
                  <tr className="bg-yellow-200 border-t-2 border-gray-600">
                    <td colSpan={3} className="p-3 text-black font-bold text-center">Overall Score</td>
                    <td className="p-3 text-black font-bold text-center">{getCurrentOverallScores().sectionWiseCapability.toFixed(1)}%</td>
                    <td className="p-3 text-black font-bold text-center">{getCurrentOverallScores().riskMitigation.toFixed(1)}%</td>
                    <td className="p-3 text-black font-bold text-center">{getCurrentOverallScores().totalMinorNC}</td>
                    <td className="p-3 text-black font-bold text-center">{getCurrentOverallScores().totalMajorNC}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}