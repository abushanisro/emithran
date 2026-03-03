'use client';

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MapPin,
  Route,
  Clock,
  Truck,
  Navigation,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

interface Address {
  id: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
}

interface RouteResult {
  distance: number; // in kilometers
  duration: number; // in minutes
  durationWithTraffic?: number; // in minutes
  route: Array<{ lat: number; lng: number }>;
  warnings?: string[];
  optimizationScore?: number; // 0-100
}

interface RouteCalculatorProps {
  fromAddress: Address | null;
  toAddress: Address | null;
  transportMode?: 'car' | 'truck' | 'bike' | 'walking';
  onRouteCalculated?: (result: RouteResult) => void;
  className?: string;
}

export default function RouteCalculator({
  fromAddress,
  toAddress,
  transportMode = 'car',
  onRouteCalculated,
  className = ''
}: RouteCalculatorProps) {
  const [loading, setLoading] = useState(false);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState(transportMode);
  const [optimizationLevel, setOptimizationLevel] = useState<'fastest' | 'shortest' | 'balanced'>('balanced');

  // Transport modes with realistic speeds and cost factors
  const transportModes = [
    {
      value: 'car',
      label: 'Car/Light Vehicle',
      icon: '🚗',
      avgSpeed: 45, // km/h in urban areas
      costPerKm: 8, // INR
      description: 'Standard delivery vehicle'
    },
    {
      value: 'truck',
      label: 'Truck/Heavy Vehicle',
      icon: '🚛',
      avgSpeed: 35, // km/h (slower due to size)
      costPerKm: 12, // INR
      description: 'For large/heavy shipments'
    },
    {
      value: 'bike',
      label: 'Motorcycle/Scooter',
      icon: '🏍️',
      avgSpeed: 35, // km/h
      costPerKm: 4, // INR
      description: 'Quick urban delivery'
    },
    {
      value: 'walking',
      label: 'Walking/Handcart',
      icon: '🚶',
      avgSpeed: 5, // km/h
      costPerKm: 2, // INR
      description: 'Local/neighborhood delivery'
    }
  ];

  const optimizationOptions = [
    { value: 'fastest', label: 'Fastest Route', description: 'Minimize travel time' },
    { value: 'shortest', label: 'Shortest Distance', description: 'Minimize distance' },
    { value: 'balanced', label: 'Balanced', description: 'Optimize time & distance' }
  ];

  // Route calculation using our API endpoint
  const calculateRouteViaAPI = async (
    fromAddress: string,
    toAddress: string,
    mode: string
  ): Promise<RouteResult> => {
    try {
      const response = await fetch('/api/route-calculation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromAddress,
          toAddress,
          transportMode: mode,
          optimizationLevel
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to calculate route');
      }

      const data = await response.json();
      
      return {
        distance: data.distance,
        duration: data.duration,
        durationWithTraffic: data.durationWithTraffic,
        route: data.fromCoords && data.toCoords ? [data.fromCoords, data.toCoords] : [],
        optimizationScore: data.optimizationScore,
        warnings: data.warnings
      };
      
    } catch (error) {
      console.error('Route calculation API error:', error);
      throw error;
    }
  };


  // Main calculation function
  const handleCalculateRoute = useCallback(async () => {
    if (!fromAddress || !toAddress) {
      setError('Both pickup and delivery addresses are required');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      // Build full address strings
      const fromAddressString = `${fromAddress.addressLine1}, ${fromAddress.city}, ${fromAddress.stateProvince}, ${fromAddress.postalCode}, ${fromAddress.country}`;
      const toAddressString = `${toAddress.addressLine1}, ${toAddress.city}, ${toAddress.stateProvince}, ${toAddress.postalCode}, ${toAddress.country}`;

      // Calculate route via API
      const result = await calculateRouteViaAPI(fromAddressString, toAddressString, selectedMode);
      
      // Add cost calculation to the result
      const mode = transportModes.find(m => m.value === selectedMode);
      const baseCost = result.distance * (mode?.costPerKm || 8);
      const optimizationFactor = (result.optimizationScore || 70) / 100;
      const cost = Math.round(baseCost * (2 - optimizationFactor) * 100) / 100;
      
      const enhancedResult = { ...result, cost };
      
      setRouteResult(enhancedResult);
      onRouteCalculated?.(enhancedResult);
      toast.success(`Route calculated: ${result.distance} km, estimated cost ₹${cost}`);
      
    } catch (err: any) {
      setError(err.message || 'Failed to calculate route');
      toast.error('Failed to calculate route');
    } finally {
      setLoading(false);
    }
  }, [fromAddress, toAddress, selectedMode, optimizationLevel, onRouteCalculated]);

  // Calculate estimated cost
  const calculateEstimatedCost = useCallback((): number => {
    if (!routeResult) return 0;
    const mode = transportModes.find(m => m.value === selectedMode);
    const baseCost = routeResult.distance * (mode?.costPerKm || 8);
    
    // Add optimization penalty/bonus
    const optimizationFactor = (routeResult.optimizationScore || 70) / 100;
    const adjustedCost = baseCost * (2 - optimizationFactor); // Better optimization = lower cost
    
    return Math.round(adjustedCost * 100) / 100;
  }, [routeResult, selectedMode]);

  // Format time display
  const formatDuration = (minutes: number): string => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // Get optimization score color
  const getScoreColor = (score?: number): string => {
    if (!score) return 'text-gray-500';
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  // Get optimization badge variant
  const getScoreBadgeVariant = (score?: number): "default" | "secondary" | "destructive" | "outline" => {
    if (!score) return 'outline';
    if (score >= 80) return 'default';
    if (score >= 60) return 'secondary';
    return 'destructive';
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Configuration Section */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-foreground flex items-center gap-2">
              <Route className="h-4 w-4" />
              Route Configuration
            </h4>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCalculateRoute}
              disabled={loading || !fromAddress || !toAddress}
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                  Calculating...
                </>
              ) : (
                <>
                  <Navigation className="h-4 w-4 mr-2" />
                  Calculate Route
                </>
              )}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Transport Mode</label>
              <Select value={selectedMode} onValueChange={setSelectedMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {transportModes.map((mode) => (
                    <SelectItem key={mode.value} value={mode.value}>
                      <div className="flex items-center gap-2">
                        <span>{mode.icon}</span>
                        <div>
                          <div className="font-medium">{mode.label}</div>
                          <div className="text-xs text-muted-foreground">{mode.description}</div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Optimization</label>
              <Select value={optimizationLevel} onValueChange={(value: any) => setOptimizationLevel(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {optimizationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <div>
                        <div className="font-medium">{option.label}</div>
                        <div className="text-xs text-muted-foreground">{option.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}


      {/* Placeholder when no addresses */}
      {(!fromAddress || !toAddress) && !routeResult && (
        <Card className="border-dashed">
          <CardContent className="p-6">
            <div className="text-center text-muted-foreground">
              <MapPin className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Select pickup and delivery addresses</p>
              <p className="text-sm">to calculate route and delivery estimates</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}