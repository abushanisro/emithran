'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import RouteCalculator from './RouteCalculator';
import { toast } from 'sonner';

// Test component to verify route calculation functionality
export default function RouteCalculatorTest() {
  const [testAddresses, setTestAddresses] = useState({
    from: {
      id: '1',
      addressLine1: 'Sector 18, Gurgaon',
      city: 'Gurgaon',
      stateProvince: 'Haryana',
      postalCode: '122001',
      country: 'India'
    },
    to: {
      id: '2', 
      addressLine1: 'Connaught Place',
      city: 'New Delhi',
      stateProvince: 'Delhi',
      postalCode: '110001',
      country: 'India'
    }
  });

  const [testResult, setTestResult] = useState(null);

  const handleRouteCalculated = (result: any) => {
    setTestResult(result);
    console.log('Route calculation result:', result);
    toast.success(`Route calculated successfully! ${result.distance} km, ${Math.floor(result.duration/60)}h ${result.duration%60}m`);
  };

  const updateFromAddress = (field: string, value: string) => {
    setTestAddresses(prev => ({
      ...prev,
      from: { ...prev.from, [field]: value }
    }));
  };

  const updateToAddress = (field: string, value: string) => {
    setTestAddresses(prev => ({
      ...prev,
      to: { ...prev.to, [field]: value }
    }));
  };

  const runPredefinedTest = () => {
    // Test with known addresses
    setTestAddresses({
      from: {
        id: '1',
        addressLine1: 'Manufacturing Hub, Sector 18',
        city: 'Gurgaon',
        stateProvince: 'Haryana', 
        postalCode: '122001',
        country: 'India'
      },
      to: {
        id: '2',
        addressLine1: 'India Gate',
        city: 'New Delhi',
        stateProvince: 'Delhi',
        postalCode: '110001',
        country: 'India'
      }
    });
    toast.info('Test addresses loaded - click Calculate Route to test');
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Route Calculator Test Suite</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button onClick={runPredefinedTest} variant="outline">
              Load Test Addresses
            </Button>
            <div className="text-sm text-muted-foreground flex items-center">
              API Key Status: {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? '✅ Configured' : '❌ Missing'}
            </div>
          </div>

          {/* From Address Input */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label className="text-base font-semibold">From Address</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Address Line 1"
                  value={testAddresses.from.addressLine1}
                  onChange={(e) => updateFromAddress('addressLine1', e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="City"
                    value={testAddresses.from.city}
                    onChange={(e) => updateFromAddress('city', e.target.value)}
                  />
                  <Input
                    placeholder="State"
                    value={testAddresses.from.stateProvince}
                    onChange={(e) => updateFromAddress('stateProvince', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Postal Code"
                    value={testAddresses.from.postalCode}
                    onChange={(e) => updateFromAddress('postalCode', e.target.value)}
                  />
                  <Input
                    placeholder="Country"
                    value={testAddresses.from.country}
                    onChange={(e) => updateFromAddress('country', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* To Address Input */}
            <div className="space-y-3">
              <Label className="text-base font-semibold">To Address</Label>
              <div className="space-y-2">
                <Input
                  placeholder="Address Line 1"
                  value={testAddresses.to.addressLine1}
                  onChange={(e) => updateToAddress('addressLine1', e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="City"
                    value={testAddresses.to.city}
                    onChange={(e) => updateToAddress('city', e.target.value)}
                  />
                  <Input
                    placeholder="State"
                    value={testAddresses.to.stateProvince}
                    onChange={(e) => updateToAddress('stateProvince', e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Postal Code"
                    value={testAddresses.to.postalCode}
                    onChange={(e) => updateToAddress('postalCode', e.target.value)}
                  />
                  <Input
                    placeholder="Country"
                    value={testAddresses.to.country}
                    onChange={(e) => updateToAddress('country', e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Test Result Display */}
          {testResult && (
            <Card className="bg-green-50 border-green-200">
              <CardContent className="p-4">
                <h4 className="font-semibold text-green-800 mb-2">✅ Test Results</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-green-600 font-medium">Distance:</span>
                    <div className="font-semibold">{testResult.distance} km</div>
                  </div>
                  <div>
                    <span className="text-green-600 font-medium">Duration:</span>
                    <div className="font-semibold">
                      {Math.floor(testResult.duration / 60)}h {testResult.duration % 60}m
                    </div>
                  </div>
                  <div>
                    <span className="text-green-600 font-medium">Cost:</span>
                    <div className="font-semibold">₹{testResult.cost || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-green-600 font-medium">Optimization:</span>
                    <div className="font-semibold">{testResult.optimizationScore || 50}%</div>
                  </div>
                </div>
                {testResult.warnings && testResult.warnings.length > 0 && (
                  <div className="mt-3 p-2 bg-yellow-100 border border-yellow-300 rounded text-sm">
                    <strong>Warnings:</strong>
                    <ul className="list-disc list-inside">
                      {testResult.warnings.map((warning: string, index: number) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Route Calculator Component */}
      <RouteCalculator
        fromAddress={testAddresses.from}
        toAddress={testAddresses.to}
        transportMode="car"
        onRouteCalculated={handleRouteCalculated}
      />

      {/* API Test Information */}
      <Card>
        <CardHeader>
          <CardTitle>API Integration Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span>Google Maps API Key</span>
              <span className={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? 'text-green-600' : 'text-red-600'}>
                {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? 'Configured ✅' : 'Not Configured ❌'}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              Expected behavior:
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>With API key: High-accuracy routes using Google Maps</li>
                <li>Without API key: Basic routes using OpenStreetMap (free)</li>
                <li>Network issues: Automatic fallback to backup providers</li>
                <li>Invalid addresses: Clear error messages with suggestions</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}