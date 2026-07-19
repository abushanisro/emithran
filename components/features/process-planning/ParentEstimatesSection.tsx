'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Upload,
  DollarSign,
  MapPin,
  Percent,
  Calculator
} from 'lucide-react';

interface ParentEstimate {
  id: string;
  imageUrl?: string;
  name: string;
  description: string;
  location: string;
  currency: string;
  sgaPercentage: number;
  profitPercentage: number;
  total: number;
}

export function ParentEstimatesSection() {
  const [parentEstimates, setParentEstimates] = useState<ParentEstimate[]>([]);

  const handleAddParentEstimate = () => {
    const newEstimate: ParentEstimate = {
      id: Date.now().toString(),
      name: '',
      description: '',
      location: '',
      currency: '',
      sgaPercentage: 0,
      profitPercentage: 0,
      total: 0,
    };
    setParentEstimates([...parentEstimates, newEstimate]);
  };

  const handleDeleteParentEstimate = (id: string) => {
    setParentEstimates(parentEstimates.filter(e => e.id !== id));
  };

  return (
    <Card className="border-l-4 border-l-primary shadow-md">
      <CardHeader className="bg-primary py-3 px-4">
        <CardTitle className="text-primary-foreground text-sm font-semibold flex items-center gap-2">
          <Calculator className="h-4 w-4" />
          Parent Estimates Hierarchy
        </CardTitle>
        <p className="text-primary-foreground/80 text-xs mt-1">
          Parent assemblies where this part is used as a child component
        </p>
      </CardHeader>
      <CardContent className="p-4">
        {parentEstimates.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-border rounded-lg bg-secondary/20">
            <div className="flex flex-col items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Calculator className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground mb-1">No parent estimates added yet</p>
                <p className="text-xs text-muted-foreground">
                  Track cost hierarchy by adding parent assemblies that use this part
                </p>
              </div>
              <Button
                onClick={handleAddParentEstimate}
                size="sm"
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Parent Estimate
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {parentEstimates.map((estimate) => (
                <Card key={estimate.id} className="border-border hover:border-primary/30 transition-colors">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                      {/* Image Column */}
                      <div className="lg:col-span-3">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <Upload className="h-3 w-3" />
                            Product Image
                          </label>
                          {estimate.imageUrl ? (
                            <img
                              src={estimate.imageUrl}
                              alt={estimate.name}
                              className="w-full h-32 object-cover rounded-md border"
                            />
                          ) : (
                            <div className="w-full h-32 bg-secondary/50 rounded-md border-2 border-dashed border-border flex flex-col items-center justify-center gap-1">
                              <Upload className="h-5 w-5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Upload Image</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Details Grid */}
                      <div className="lg:col-span-9">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {/* Name */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">Estimate Name</label>
                            <Input
                              value={estimate.name}
                              onChange={(e) => {
                                const updated = parentEstimates.map(est =>
                                  est.id === estimate.id ? { ...est, name: e.target.value } : est
                                );
                                setParentEstimates(updated);
                              }}
                              className="h-9 text-sm"
                              placeholder="Enter estimate name"
                            />
                          </div>

                          {/* Description */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">Description</label>
                            <Input
                              value={estimate.description}
                              onChange={(e) => {
                                const updated = parentEstimates.map(est =>
                                  est.id === estimate.id ? { ...est, description: e.target.value } : est
                                );
                                setParentEstimates(updated);
                              }}
                              className="h-9 text-sm"
                              placeholder="Product description"
                            />
                          </div>

                          {/* Location */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              Location
                            </label>
                            <Input
                              value={estimate.location}
                              onChange={(e) => {
                                const updated = parentEstimates.map(est =>
                                  est.id === estimate.id ? { ...est, location: e.target.value } : est
                                );
                                setParentEstimates(updated);
                              }}
                              className="h-9 text-sm"
                              placeholder="Manufacturing location"
                            />
                          </div>

                          {/* Currency */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <DollarSign className="h-3 w-3" />
                              Currency
                            </label>
                            <Input
                              value={estimate.currency}
                              onChange={(e) => {
                                const updated = parentEstimates.map(est =>
                                  est.id === estimate.id ? { ...est, currency: e.target.value } : est
                                );
                                setParentEstimates(updated);
                              }}
                              className="h-9 text-sm"
                              placeholder="USD"
                            />
                          </div>

                          {/* SGA % */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <Percent className="h-3 w-3" />
                              SGA %
                            </label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              value={estimate.sgaPercentage}
                              onChange={(e) => {
                                const updated = parentEstimates.map(est =>
                                  est.id === estimate.id ? { ...est, sgaPercentage: parseFloat(e.target.value) || 0 } : est
                                );
                                setParentEstimates(updated);
                              }}
                              className="h-9 text-sm"
                              placeholder="0.0"
                            />
                          </div>

                          {/* Profit % */}
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                              <Percent className="h-3 w-3" />
                              Profit %
                            </label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              max="100"
                              value={estimate.profitPercentage}
                              onChange={(e) => {
                                const updated = parentEstimates.map(est =>
                                  est.id === estimate.id ? { ...est, profitPercentage: parseFloat(e.target.value) || 0 } : est
                                );
                                setParentEstimates(updated);
                              }}
                              className="h-9 text-sm"
                              placeholder="0.0"
                            />
                          </div>
                        </div>

                        {/* Total and Actions Row */}
                        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                          <div className="flex items-center gap-4">
                            <div>
                              <label className="text-xs font-medium text-muted-foreground">Total Cost</label>
                              <div className="flex items-center gap-2 mt-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={estimate.total}
                                  onChange={(e) => {
                                    const updated = parentEstimates.map(est =>
                                      est.id === estimate.id ? { ...est, total: parseFloat(e.target.value) || 0 } : est
                                    );
                                    setParentEstimates(updated);
                                  }}
                                  className="h-9 text-sm w-32"
                                  placeholder="0.00"
                                />
                                <Badge variant="outline" className="text-xs">
                                  {estimate.currency || 'USD'}
                                </Badge>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-3"
                              title="Edit Estimate"
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleDeleteParentEstimate(estimate.id)}
                              title="Remove Estimate"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <Button
                onClick={handleAddParentEstimate}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                Add Another Parent Estimate
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
