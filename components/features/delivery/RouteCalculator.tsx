'use client';

import { Card, CardContent } from '@/components/ui/card';
import { MapPin, AlertTriangle } from 'lucide-react';

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
  distance: number;
  duration: number;
  durationWithTraffic?: number;
  route: Array<{ lat: number; lng: number }>;
  warnings?: string[];
  optimizationScore?: number;
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
  className = ''
}: RouteCalculatorProps) {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* Placeholder when no addresses */}
      {(!fromAddress || !toAddress) && (
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