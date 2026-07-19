'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Package,
  DollarSign,
  Award,
  Calculator,
  Edit,
  Save,
  X,
  BarChart3,
  Target
} from 'lucide-react';
import { toast } from 'sonner';
import { useVendors, Vendor } from '@/lib/api/hooks/useVendors';

interface BOMPart {
  id: string;
  partNumber: string;
  description: string;
  category: string;
  quantity: number;
  price?: number;
}

interface BomPartCostAnalysisProps {
  projectId: string;
  bomParts: BOMPart[];
  selectedVendors: Vendor[];
  onAnalysisComplete?: (data: any) => void;
}

export function BomPartCostAnalysis({ 
  projectId, 
  bomParts, 
  selectedVendors,
  onAnalysisComplete 
}: BomPartCostAnalysisProps) {
  const [selectedPartId, setSelectedPartId] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [vendorCosts, setVendorCosts] = useState<Record<string, Record<string, number>>>({});
  const [vendorLeadTimes, setVendorLeadTimes] = useState<Record<string, Record<string, number>>>({});
  const [vendorDevCosts, setVendorDevCosts] = useState<Record<string, Record<string, number>>>({});

  const selectedPart = bomParts.find(part => part.id === selectedPartId);

  // Initialize data for a part
  const initializePartData = (partId: string) => {
    if (!vendorCosts[partId]) {
      const costs: Record<string, number> = {};
      const leadTimes: Record<string, number> = {};
      const devCosts: Record<string, number> = {};
      
      selectedVendors.forEach(vendor => {
        costs[vendor.id] = 0;
        leadTimes[vendor.id] = 0;
        devCosts[vendor.id] = 0;
      });

      setVendorCosts(prev => ({ ...prev, [partId]: costs }));
      setVendorLeadTimes(prev => ({ ...prev, [partId]: leadTimes }));
      setVendorDevCosts(prev => ({ ...prev, [partId]: devCosts }));
    }
  };

  // Calculate rankings
  const calculateRankings = () => {
    if (!selectedPartId || !vendorCosts[selectedPartId]) return null;

    const costs = vendorCosts[selectedPartId];
    const leadTimes = vendorLeadTimes[selectedPartId];
    const devCosts = vendorDevCosts[selectedPartId];

    // Cost ranking (lower is better)
    const costRanks = selectedVendors
      .filter(v => costs[v.id] > 0)
      .sort((a, b) => costs[a.id] - costs[b.id])
      .reduce((acc, vendor, index) => {
        acc[vendor.id] = index + 1;
        return acc;
      }, {} as Record<string, number>);

    // Lead time ranking (lower is better)
    const leadTimeRanks = selectedVendors
      .filter(v => leadTimes[v.id] > 0)
      .sort((a, b) => leadTimes[a.id] - leadTimes[b.id])
      .reduce((acc, vendor, index) => {
        acc[vendor.id] = index + 1;
        return acc;
      }, {} as Record<string, number>);

    // Development cost ranking (lower is better)
    const devCostRanks = selectedVendors
      .filter(v => devCosts[v.id] > 0)
      .sort((a, b) => devCosts[a.id] - devCosts[b.id])
      .reduce((acc, vendor, index) => {
        acc[vendor.id] = index + 1;
        return acc;
      }, {} as Record<string, number>);

    // Overall ranking (simple average)
    const overallRanks = selectedVendors.reduce((acc, vendor) => {
      const costRank = costRanks[vendor.id] || 999;
      const leadRank = leadTimeRanks[vendor.id] || 999;
      const devRank = devCostRanks[vendor.id] || 999;
      const avgRank = (costRank + leadRank + devRank) / 3;
      acc[vendor.id] = avgRank;
      return acc;
    }, {} as Record<string, number>);

    // Sort by overall rank
    const sortedOverallRanks = Object.entries(overallRanks)
      .sort(([,a], [,b]) => a - b)
      .reduce((acc, [vendorId], index) => {
        acc[vendorId] = index + 1;
        return acc;
      }, {} as Record<string, number>);

    return {
      cost: costRanks,
      leadTime: leadTimeRanks,
      devCost: devCostRanks,
      overall: sortedOverallRanks
    };
  };

  const rankings = calculateRankings();

  // Calculate comprehensive dashboard data for all parts
  const dashboardData = useMemo(() => {
    const partWiseResults: Record<string, any> = {};
    const overallScores: Record<string, number> = {};
    
    // Calculate for each part that has data
    bomParts.forEach(part => {
      if (vendorCosts[part.id] && selectedVendors.length > 0) {
        const costs = vendorCosts[part.id];
        const leadTimes = vendorLeadTimes[part.id] || {};
        const devCosts = vendorDevCosts[part.id] || {};
        
        // Calculate rankings for this part
        const costRanks = selectedVendors
          .filter(v => costs[v.id] > 0)
          .sort((a, b) => costs[a.id] - costs[b.id])
          .reduce((acc, vendor, index) => {
            acc[vendor.id] = index + 1;
            return acc;
          }, {} as Record<string, number>);
        
        const leadTimeRanks = selectedVendors
          .filter(v => leadTimes[v.id] > 0)
          .sort((a, b) => leadTimes[a.id] - leadTimes[b.id])
          .reduce((acc, vendor, index) => {
            acc[vendor.id] = index + 1;
            return acc;
          }, {} as Record<string, number>);
        
        const devCostRanks = selectedVendors
          .filter(v => devCosts[v.id] > 0)
          .sort((a, b) => devCosts[a.id] - devCosts[b.id])
          .reduce((acc, vendor, index) => {
            acc[vendor.id] = index + 1;
            return acc;
          }, {} as Record<string, number>);
        
        // Overall ranking for this part
        const partOverallRanks = selectedVendors.reduce((acc, vendor) => {
          const costRank = costRanks[vendor.id] || 999;
          const leadRank = leadTimeRanks[vendor.id] || 999;
          const devRank = devCostRanks[vendor.id] || 999;
          const avgRank = (costRank + leadRank + devRank) / 3;
          acc[vendor.id] = avgRank;
          return acc;
        }, {} as Record<string, number>);
        
        // Find winner for this part
        const winnerEntry = Object.entries(partOverallRanks)
          .filter(([vendorId]) => costs[vendorId] > 0)
          .sort(([,a], [,b]) => a - b)[0];
        
        if (winnerEntry) {
          const [winnerId] = winnerEntry;
          const winner = selectedVendors.find(v => v.id === winnerId);
          
          partWiseResults[part.id] = {
            part,
            winner,
            totalCost: costs[winnerId] * part.quantity,
            unitCost: costs[winnerId],
            leadTime: leadTimes[winnerId] || 0,
            devCost: devCosts[winnerId] || 0,
            rankings: { cost: costRanks, leadTime: leadTimeRanks, devCost: devCostRanks, overall: partOverallRanks }
          };
          
          // Add to overall scores
          selectedVendors.forEach(vendor => {
            if (!overallScores[vendor.id]) overallScores[vendor.id] = 0;
            overallScores[vendor.id] += (6 - (partOverallRanks[vendor.id] || 6)) * part.quantity;
          });
        }
      }
    });
    
    // Calculate overall winner
    const overallWinner = Object.entries(overallScores)
      .sort(([,a], [,b]) => b - a)[0];
    
    return {
      partWiseResults,
      overallScores,
      overallWinner: overallWinner ? selectedVendors.find(v => v.id === overallWinner[0]) : null,
      totalParts: Object.keys(partWiseResults).length,
      totalValue: Object.values(partWiseResults).reduce((sum: number, result: any) => sum + result.totalCost, 0)
    };
  }, [bomParts, vendorCosts, vendorLeadTimes, vendorDevCosts, selectedVendors]);

  const updateVendorCost = (vendorId: string, value: number) => {
    if (!selectedPartId) return;
    setVendorCosts(prev => ({
      ...prev,
      [selectedPartId]: {
        ...prev[selectedPartId],
        [vendorId]: value
      }
    }));
  };

  const updateVendorLeadTime = (vendorId: string, value: number) => {
    if (!selectedPartId) return;
    setVendorLeadTimes(prev => ({
      ...prev,
      [selectedPartId]: {
        ...prev[selectedPartId],
        [vendorId]: value
      }
    }));
  };

  const updateVendorDevCost = (vendorId: string, value: number) => {
    if (!selectedPartId) return;
    setVendorDevCosts(prev => ({
      ...prev,
      [selectedPartId]: {
        ...prev[selectedPartId],
        [vendorId]: value
      }
    }));
  };

  const handleSave = () => {
    if (!selectedPartId || !selectedPart) return;
    
    setIsEditing(false);
    const bestVendor = rankings ? selectedVendors.find(v => rankings.overall[v.id] === 1) : null;
    
    toast.success(
      `Vendor ranking completed for ${selectedPart.partNumber}. ` +
      `${bestVendor ? `Best vendor: ${bestVendor.name}` : ''}`
    );
  };

  // Initialize data when part is selected
  React.useEffect(() => {
    if (selectedPartId) {
      initializePartData(selectedPartId);
    }
  }, [selectedPartId, selectedVendors]);

  if (bomParts.length === 0) {
    return (
      <div className="text-center py-12">
        <Package className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No BOM Parts Available</h3>
        <p className="text-gray-500">Please select BOM parts to perform cost analysis.</p>
      </div>
    );
  }

  if (selectedVendors.length === 0) {
    return (
      <div className="text-center py-12">
        <DollarSign className="h-12 w-12 mx-auto text-gray-400 mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No Vendors Selected</h3>
        <p className="text-gray-500">Please select vendors to compare costs for BOM parts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Part-wise Cost Vendor Rating Dashboard */}
      {dashboardData.totalParts > 0 && (
        <Card className="bg-gradient-to-br from-blue-900/20 to-purple-900/20 border-blue-500/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-300">
              <Award className="h-6 w-6" />
              Part-wise Cost Vendor Rating Dashboard
            </CardTitle>
            <p className="text-blue-200 text-sm">
              Top vendors for each BOM part and overall performance ranking
            </p>
          </CardHeader>
          <CardContent>
            {/* Overall Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card className="bg-green-900/30 border-green-500/50">
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-300">{dashboardData.totalParts}</div>
                    <div className="text-sm text-green-200">Parts Analyzed</div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-blue-900/30 border-blue-500/50">
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-300">{selectedVendors.length}</div>
                    <div className="text-sm text-blue-200">Vendors Compared</div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-purple-900/30 border-purple-500/50">
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-300">${dashboardData.totalValue.toFixed(2)}</div>
                    <div className="text-sm text-purple-200">Total Project Value</div>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-yellow-900/30 border-yellow-500/50">
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-yellow-300">{dashboardData.overallWinner?.name || 'TBD'}</div>
                    <div className="text-sm text-yellow-200">Overall Winner</div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Part-wise Winners Table */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Package className="h-5 w-5" />
                Top Vendor per BOM Part
              </h3>
              <div className="bg-gray-900/50 rounded-lg overflow-hidden border border-gray-700">
                <Table>
                  <TableHeader className="bg-gray-800">
                    <TableRow>
                      <TableHead className="text-gray-300">Part Number</TableHead>
                      <TableHead className="text-gray-300">Quantity</TableHead>
                      <TableHead className="text-gray-300">Winner</TableHead>
                      <TableHead className="text-gray-300">Unit Cost</TableHead>
                      <TableHead className="text-gray-300">Total Cost</TableHead>
                      <TableHead className="text-gray-300">Lead Time</TableHead>
                      <TableHead className="text-gray-300">Overall Rank</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.values(dashboardData.partWiseResults).map((result: any) => (
                      <TableRow key={result.part.id} className="border-gray-700">
                        <TableCell>
                          <div className="font-medium text-white">{result.part.partNumber}</div>
                          <div className="text-sm text-gray-400">{result.part.description}</div>
                        </TableCell>
                        <TableCell className="text-white">{result.part.quantity} pcs</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Award className="h-4 w-4 text-yellow-500" />
                            <span className="font-medium text-green-400">{result.winner?.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-white">${result.unitCost.toFixed(2)}</TableCell>
                        <TableCell className="text-yellow-400 font-medium">${result.totalCost.toFixed(2)}</TableCell>
                        <TableCell className="text-white">{result.leadTime} days</TableCell>
                        <TableCell>
                          <Badge className="bg-green-600 text-white">#1 🏆</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Overall Vendor Performance Ranking */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Target className="h-5 w-5" />
                Overall Vendor Performance Ranking
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(dashboardData.overallScores)
                  .sort(([,a], [,b]) => b - a)
                  .map(([vendorId, score], index) => {
                    const vendor = selectedVendors.find(v => v.id === vendorId);
                    const partsWon = Object.values(dashboardData.partWiseResults)
                      .filter((result: any) => result.winner?.id === vendorId).length;
                    
                    return (
                      <Card 
                        key={vendorId} 
                        className={`${
                          index === 0 
                            ? 'bg-gradient-to-br from-yellow-900/30 to-yellow-800/20 border-yellow-500/50' 
                            : index === 1
                            ? 'bg-gradient-to-br from-gray-600/30 to-gray-500/20 border-gray-400/50'
                            : index === 2
                            ? 'bg-gradient-to-br from-orange-900/30 to-orange-800/20 border-orange-500/50'
                            : 'bg-gray-900/50 border-gray-600/50'
                        }`}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              {index === 0 && <Award className="h-5 w-5 text-yellow-500" />}
                              {index === 1 && <Award className="h-5 w-5 text-gray-400" />}
                              {index === 2 && <Award className="h-5 w-5 text-orange-500" />}
                              <Badge 
                                variant="outline"
                                className={`${
                                  index === 0 
                                    ? 'border-yellow-500 text-yellow-400' 
                                    : index === 1
                                    ? 'border-gray-400 text-gray-300'
                                    : index === 2
                                    ? 'border-orange-500 text-orange-400'
                                    : 'border-gray-600 text-gray-400'
                                }`}
                              >
                                #{index + 1}
                              </Badge>
                            </div>
                            <div className="text-right">
                              <div className="text-lg font-bold text-white">{score.toFixed(1)}</div>
                              <div className="text-xs text-gray-400">Score</div>
                            </div>
                          </div>
                          <div>
                            <h4 className="font-semibold text-white mb-1">{vendor?.name}</h4>
                            <div className="text-sm text-gray-300">
                              Won {partsWon} part{partsWon !== 1 ? 's' : ''} of {dashboardData.totalParts}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Win rate: {((partsWon / dashboardData.totalParts) * 100).toFixed(1)}%
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header with Part Selection */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                BOM Part-wise Vendor Cost Analysis & Ranking
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Select a BOM part and analyze vendor costs to get rankings
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              <Select value={selectedPartId} onValueChange={setSelectedPartId}>
                <SelectTrigger className="w-80">
                  <SelectValue placeholder="Select a BOM part for analysis" />
                </SelectTrigger>
                <SelectContent>
                  {bomParts.map((part) => (
                    <SelectItem key={part.id} value={part.id}>
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        <span>{part.partNumber} - {part.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {selectedPartId && (
                <Badge variant="outline">
                  Qty: {selectedPart?.quantity} pcs
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {selectedPartId && (
        <>
          {/* Cost Analysis Input */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Cost Analysis for {selectedPart?.partNumber}</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Enter vendor-specific cost data to calculate rankings
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {!isEditing ? (
                    <Button onClick={() => setIsEditing(true)} size="sm">
                      <Edit className="h-4 w-4 mr-2" />
                      Edit Cost Data
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button onClick={() => setIsEditing(false)} variant="outline" size="sm">
                        <X className="h-4 w-4 mr-2" />
                        Cancel
                      </Button>
                      <Button onClick={handleSave} size="sm">
                        <Save className="h-4 w-4 mr-2" />
                        Save & Rank Vendors
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Net Price/Unit ($)</TableHead>
                      <TableHead>Lead Time (Days)</TableHead>
                      <TableHead>Development Cost ($)</TableHead>
                      <TableHead>Cost Rank</TableHead>
                      <TableHead>Lead Time Rank</TableHead>
                      <TableHead>Dev Cost Rank</TableHead>
                      <TableHead>Overall Rank</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedVendors.map(vendor => {
                      const cost = vendorCosts[selectedPartId]?.[vendor.id] || 0;
                      const leadTime = vendorLeadTimes[selectedPartId]?.[vendor.id] || 0;
                      const devCost = vendorDevCosts[selectedPartId]?.[vendor.id] || 0;
                      const overallRank = rankings?.overall[vendor.id];
                      
                      return (
                        <TableRow key={vendor.id} className={overallRank === 1 ? 'bg-green-50' : ''}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {overallRank === 1 && <Award className="h-4 w-4 text-green-600" />}
                              {vendor.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={cost}
                                onChange={(e) => updateVendorCost(vendor.id, parseFloat(e.target.value) || 0)}
                                className="w-24"
                                step="0.01"
                              />
                            ) : (
                              <span>${cost.toFixed(2)}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={leadTime}
                                onChange={(e) => updateVendorLeadTime(vendor.id, parseFloat(e.target.value) || 0)}
                                className="w-24"
                                step="1"
                              />
                            ) : (
                              <span>{leadTime} days</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                type="number"
                                value={devCost}
                                onChange={(e) => updateVendorDevCost(vendor.id, parseFloat(e.target.value) || 0)}
                                className="w-24"
                                step="0.01"
                              />
                            ) : (
                              <span>${devCost.toFixed(2)}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {rankings?.cost[vendor.id] ? (
                              <Badge variant={rankings.cost[vendor.id] === 1 ? 'default' : 'outline'}>
                                #{rankings.cost[vendor.id]}
                              </Badge>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            {rankings?.leadTime[vendor.id] ? (
                              <Badge variant={rankings.leadTime[vendor.id] === 1 ? 'default' : 'outline'}>
                                #{rankings.leadTime[vendor.id]}
                              </Badge>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            {rankings?.devCost[vendor.id] ? (
                              <Badge variant={rankings.devCost[vendor.id] === 1 ? 'default' : 'outline'}>
                                #{rankings.devCost[vendor.id]}
                              </Badge>
                            ) : '-'}
                          </TableCell>
                          <TableCell>
                            {overallRank ? (
                              <Badge 
                                variant={overallRank === 1 ? 'default' : 'secondary'}
                                className={overallRank === 1 ? 'bg-green-600 text-white' : ''}
                              >
                                #{overallRank} {overallRank === 1 ? '🏆' : ''}
                              </Badge>
                            ) : '-'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Winner Summary */}
          {rankings && (
            <Card className="bg-green-50 border-green-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-800">
                  <Target className="h-5 w-5" />
                  Recommended Vendor for {selectedPart?.partNumber}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const winnerVendor = selectedVendors.find(v => rankings.overall[v.id] === 1);
                  if (!winnerVendor) return <p>No winner determined yet. Please enter cost data.</p>;
                  
                  return (
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xl font-bold text-green-800 flex items-center gap-2">
                          <Award className="h-5 w-5" />
                          {winnerVendor.name}
                        </h3>
                        <p className="text-green-600">
                          Best overall ranking based on cost, lead time, and development cost
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold">${vendorCosts[selectedPartId]?.[winnerVendor.id]?.toFixed(2) || '0.00'}</div>
                        <div className="text-sm text-green-600">Net Price per Unit</div>
                      </div>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}