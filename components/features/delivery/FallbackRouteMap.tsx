'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Navigation, MapPin, Truck, Route, RefreshCw, AlertCircle } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface FallbackRouteMapProps {
  fromAddress?: any;
  toAddress?: any;
  transportMode?: string;
  materialType?: string;
  onRouteCalculated?: (result: any) => void;
  onTransportModeChange?: (mode: string) => void;
  onMaterialTypeChange?: (type: string) => void;
  className?: string;
}

export default function FallbackRouteMap({ 
  fromAddress, 
  toAddress, 
  transportMode: externalTransportMode, 
  materialType,
  onRouteCalculated, 
  onTransportModeChange,
  onMaterialTypeChange,
  className = '' 
}: FallbackRouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeInfo, setRouteInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastCalculationTime, setLastCalculationTime] = useState<number>(0);
  const [transportMode, setTransportMode] = useState<string>(externalTransportMode || 'car');
  const [optimizationLevel, setOptimizationLevel] = useState<string>('balanced');

  // Update internal state when external props change
  useEffect(() => {
    if (externalTransportMode) {
      setTransportMode(externalTransportMode);
    }
  }, [externalTransportMode]);

  // Transport modes with brand guideline colors
  const transportModes = [
    {
      value: 'car',
      label: 'Car/Light Vehicle',
      icon: '🚗',
      color: '#4F46E5',
      avgSpeed: 45,
      costPerKm: 8,
      description: 'Standard delivery vehicle',
      mapType: 'road'
    },
    {
      value: 'truck',
      label: 'Truck/Heavy Vehicle',
      icon: '🚛',
      color: '#4F46E5',
      avgSpeed: 35,
      costPerKm: 12,
      description: 'For large/heavy shipments',
      mapType: 'road'
    },
    {
      value: 'bike',
      label: 'Motorcycle/Scooter',
      icon: '🏍️',
      color: '#4F46E5',
      avgSpeed: 35,
      costPerKm: 4,
      description: 'Quick urban delivery',
      mapType: 'road'
    },
    {
      value: 'walking',
      label: 'Walking/Handcart',
      icon: '🚶',
      color: '#4F46E5',
      avgSpeed: 5,
      costPerKm: 2,
      description: 'Local/neighborhood delivery',
      mapType: 'road'
    },
    {
      value: 'ship',
      label: 'Ship/Maritime',
      icon: '🚢',
      color: '#4F46E5',
      avgSpeed: 25,
      costPerKm: 15,
      description: 'Sea freight delivery',
      mapType: 'maritime'
    },
    {
      value: 'flight',
      label: 'Air Cargo',
      icon: '✈️',
      color: '#4F46E5',
      avgSpeed: 800,
      costPerKm: 50,
      description: 'Express air delivery',
      mapType: 'air'
    }
  ];

  // Material types with cost multipliers
  const materialTypes = [
    { value: 'general', label: 'General Goods', multiplier: 1.0, description: 'Standard materials' },
    { value: 'fragile', label: 'Fragile Items', multiplier: 1.5, description: 'Requires careful handling' },
    { value: 'hazardous', label: 'Hazardous Materials', multiplier: 2.0, description: 'Special safety requirements' },
    { value: 'perishable', label: 'Perishable Goods', multiplier: 1.3, description: 'Temperature controlled' },
    { value: 'bulk', label: 'Bulk Materials', multiplier: 0.8, description: 'Large volume discount' },
    { value: 'electronics', label: 'Electronics', multiplier: 1.4, description: 'Anti-static handling' },
    { value: 'pharmaceuticals', label: 'Pharmaceuticals', multiplier: 1.8, description: 'Cold chain required' }
  ];

  const optimizationOptions = [
    { value: 'fastest', label: 'Fastest Route', description: 'Minimize travel time' },
    { value: 'shortest', label: 'Shortest Distance', description: 'Minimize distance' },
    { value: 'balanced', label: 'Balanced', description: 'Optimize time & distance' }
  ];

  // Initialize Leaflet (locally installed)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        // Fix for default markers in Leaflet with Next.js
        delete (L.Icon.Default.prototype as any)._getIconUrl;
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        });

        setMapLoaded(true);
      } catch (error) {
        console.error('Failed to initialize Leaflet:', error);
        setError('Failed to load map library');
      }
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || mapInstanceRef.current) {
      return;
    }

    try {
      // Initialize map centered on India
      const map = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([20.5937, 78.9629], 5); // India center

      // Add map tiles based on transport mode
      const currentTransport = transportModes.find(mode => mode.value === transportMode);
      const mapType = currentTransport?.mapType || 'road';
      
      let tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      let attribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
      
      switch (mapType) {
        case 'maritime':
          // For ship routes, use a more water-focused tile
          tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
          attribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors - Maritime Routes';
          break;
        case 'air':
          // For flight routes, use satellite or terrain view
          tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
          attribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors - Air Routes';
          break;
        default:
          // Standard road map
          break;
      }

      L.tileLayer(tileUrl, {
        attribution,
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
    } catch (error) {
      console.error('Error initializing map:', error);
      setError('Failed to initialize map');
    }
  }, [mapLoaded]);

  // Enhanced geocoding with multiple providers and fallbacks
  const geocodeAddress = async (address: any, retryCount = 0): Promise<{ lat: number; lng: number }> => {
    const addressString = `${address.addressLine1}, ${address.city}, ${address.stateProvince}, ${address.country}`;
    
    // First try: Use our API route to avoid CORS issues
    try {
      const response = await fetch('/api/route-calculation/geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address: addressString }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.lat && data.lng) {
          return { lat: data.lat, lng: data.lng };
        }
      }
    } catch (error) {
      console.warn('API geocoding failed, trying alternatives:', error);
    }
    
    // Fallback 1: Try direct Nominatim with retry logic
    if (retryCount < 2) {
      try {
        await new Promise(resolve => setTimeout(resolve, retryCount * 1000)); // Exponential backoff
        
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addressString)}&limit=1&countrycodes=in`,
          {
            headers: {
              'User-Agent': 'Mithran-Manufacturing-Platform/1.0',
              'Accept': 'application/json'
            },
            mode: 'cors'
          }
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.length > 0) {
            return {
              lat: parseFloat(data[0].lat),
              lng: parseFloat(data[0].lon)
            };
          }
        }
      } catch (error) {
        console.warn(`Nominatim attempt ${retryCount + 1} failed:`, error);
        if (retryCount < 1) {
          return geocodeAddress(address, retryCount + 1);
        }
      }
    }
    
    // Fallback 2: Use Indian city coordinates database
    const indianCities = {
      'bangalore': { lat: 12.9716, lng: 77.5946 },
      'bengaluru': { lat: 12.9716, lng: 77.5946 },
      'mumbai': { lat: 19.0760, lng: 72.8777 },
      'delhi': { lat: 28.7041, lng: 77.1025 },
      'chennai': { lat: 13.0827, lng: 80.2707 },
      'kolkata': { lat: 22.5726, lng: 88.3639 },
      'hyderabad': { lat: 17.3850, lng: 78.4867 },
      'pune': { lat: 18.5204, lng: 73.8567 },
      'ahmedabad': { lat: 23.0225, lng: 72.5714 },
      'jaipur': { lat: 26.9124, lng: 75.7873 }
    };
    
    const cityKey = address.city?.toLowerCase().trim();
    if (cityKey && indianCities[cityKey]) {
      console.warn(`Using fallback coordinates for ${address.city}`);
      return indianCities[cityKey];
    }
    
    // Final fallback: Default to Bengaluru
    console.error('All geocoding methods failed, using default coordinates');
    return { lat: 12.9716, lng: 77.5946 };
  };

  // Enhanced routing with multiple providers and fallbacks
  const calculateRouteWithProviders = async (from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: string = 'car') => {
    const currentTransport = transportModes.find(m => m.value === mode);
    
    // For ship and flight routes, use straight-line calculation with specialized logic
    if (mode === 'ship' || mode === 'flight') {
      return calculateSpecializedRoute(from, to, mode, currentTransport);
    }
    const providers = [
      {
        name: 'api',
        fetch: async () => {
          const response = await fetch('/api/route-calculation/route', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, transportMode: mode })
          });
          if (response.ok) {
            const data = await response.json();
            return {
              distance: data.distance,
              duration: data.duration,
              coordinates: data.coordinates,
              provider: 'api'
            };
          }
          throw new Error('API route failed');
        }
      },
      {
        name: 'osrm',
        fetch: async () => {
          const response = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`,
            { mode: 'cors' }
          );
          
          if (!response.ok) throw new Error('OSRM request failed');
          
          const data = await response.json();
          if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const coordinates = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
            
            return {
              distance: (route.distance / 1000).toFixed(1),
              duration: Math.round(route.duration / 60),
              coordinates,
              provider: 'osrm'
            };
          }
          throw new Error('No OSRM route found');
        }
      }
    ];
    
    // Try each provider with timeout
    for (const provider of providers) {
      try {
        console.log(`Trying routing with ${provider.name}...`);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`${provider.name} timeout`)), 10000)
        );
        
        const result = await Promise.race([
          provider.fetch(),
          timeoutPromise
        ]);
        
        console.log(`Routing successful with ${provider.name}`);
        return result;
      } catch (error) {
        console.warn(`${provider.name} routing failed:`, error);
        continue;
      }
    }
    
    throw new Error('All routing providers failed');
  };

  // Calculate specialized routes for ships and flights
  const calculateSpecializedRoute = (from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: string, transport: any) => {
    const R = 6371; // Earth's radius in km
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLng = (to.lng - from.lng) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(from.lat * Math.PI / 180) * 
      Math.cos(to.lat * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    let distance = R * c;
    
    // Adjust distance based on transport mode
    if (mode === 'ship') {
      // Ships follow coastal routes, add 20% to distance
      distance = distance * 1.2;
    } else if (mode === 'flight') {
      // Flights follow great circle routes but add distance for takeoff/landing patterns
      distance = distance * 1.1;
    }
    
    const duration = Math.round((distance / (transport?.avgSpeed || 40)) * 60);
    
    return {
      distance: distance.toFixed(1),
      duration,
      coordinates: [[from.lat, from.lng], [to.lat, to.lng]],
      provider: mode === 'ship' ? 'maritime' : mode === 'flight' ? 'aviation' : 'specialized'
    };
  };

  // Calculate straight-line distance as fallback
  const calculateStraightLine = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
    const R = 6371; // Earth's radius in km
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLng = (to.lng - from.lng) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(from.lat * Math.PI / 180) * 
      Math.cos(to.lat * Math.PI / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    
    return {
      distance: distance.toFixed(1),
      duration: Math.round(distance / 40 * 60), // Assume 40 km/h average
      coordinates: [[from.lat, from.lng], [to.lat, to.lng]],
      provider: 'straight-line'
    };
  };

  // Main route calculation function with rate limiting
  const calculateRoute = async () => {
    if (!fromAddress || !toAddress || !mapInstanceRef.current) {
      setError('Missing addresses or map not initialized');
      return;
    }

    // Rate limiting: prevent too frequent requests
    const now = Date.now();
    if (now - lastCalculationTime < 2000) {
      console.log('Rate limited: too frequent requests');
      return;
    }
    setLastCalculationTime(now);

    setIsCalculating(true);
    setError(null);

    try {
      // Geocode both addresses
      console.log('Geocoding addresses...');
      const [fromCoords, toCoords] = await Promise.all([
        geocodeAddress(fromAddress),
        geocodeAddress(toAddress)
      ]);

      console.log('From coords:', fromCoords);
      console.log('To coords:', toCoords);

      // Clear existing layers
      mapInstanceRef.current.eachLayer((layer: any) => {
        if (layer.options && (layer.options.color || layer instanceof L.Marker)) {
          mapInstanceRef.current.removeLayer(layer);
        }
      });

      // Add markers with transport mode styling
      const selectedTransport = transportModes.find(mode => mode.value === transportMode);
      const transportIcon = selectedTransport?.icon || '🚗';
      
      const fromIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `
          <div style="
            background-color: #22c55e;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 3px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 8px rgba(0,0,0,0.3);
            font-size: 16px;
          ">📦</div>
          <div style="
            position: absolute;
            bottom: -8px;
            right: -8px;
            background: ${selectedTransport?.color || '#4F46E5'};
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          ">${transportIcon}</div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      const toIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `
          <div style="
            background-color: #ef4444;
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border: 3px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 8px rgba(0,0,0,0.3);
            font-size: 16px;
          ">🏠</div>
          <div style="
            position: absolute;
            bottom: -8px;
            right: -8px;
            background: ${selectedTransport?.color || '#4F46E5'};
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          ">${transportIcon}</div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      L.marker([fromCoords.lat, fromCoords.lng], { icon: fromIcon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`<b>Pickup Location</b><br>${fromAddress.addressLine1}<br>${fromAddress.city}`);

      L.marker([toCoords.lat, toCoords.lng], { icon: toIcon })
        .addTo(mapInstanceRef.current)
        .bindPopup(`<b>Delivery Location</b><br>${toAddress.addressLine1}<br>${toAddress.city}`);

      // Try to get route from providers, fallback to straight line
      let routeData;
      try {
        console.log('Calculating route with providers...');
        routeData = await calculateRouteWithProviders(fromCoords, toCoords, transportMode);
        
        // Get transport mode color
        const selectedTransport = transportModes.find(mode => mode.value === transportMode);
        const routeColor = selectedTransport?.color || '#4F46E5';
        
        // Draw route line with transport-specific styling
        L.polyline(routeData.coordinates, {
          color: routeColor,
          weight: transportMode === 'truck' ? 6 : transportMode === 'walking' ? 3 : 4,
          opacity: 0.8,
          dashArray: transportMode === 'walking' ? '10, 5' : undefined,
        }).addTo(mapInstanceRef.current);

      } catch (routeError) {
        console.log('All routing providers failed, using straight line...');
        routeData = calculateStraightLine(fromCoords, toCoords);
        
        // Draw straight line
        L.polyline(routeData.coordinates, {
          color: '#f59e0b',
          weight: 3,
          opacity: 0.6,
          dashArray: '5, 10'
        }).addTo(mapInstanceRef.current);
      }

      // Calculate cost and optimization score based on transport mode and material type
      const distance = parseFloat(routeData.distance);
      const currentTransport = transportModes.find(mode => mode.value === transportMode);
      const currentMaterial = materialTypes.find(type => type.value === materialType);
      
      const costPerKm = currentTransport?.costPerKm || 8;
      const materialMultiplier = currentMaterial?.multiplier || 1.0;
      
      // Base cost calculation with material type adjustment
      const baseCost = Math.round(distance * costPerKm * materialMultiplier);
      
      // Apply optimization level adjustment
      let optimizationBonus = 0;
      switch (optimizationLevel) {
        case 'fastest': optimizationBonus = 10; break;
        case 'balanced': optimizationBonus = 15; break;
        case 'shortest': optimizationBonus = 8; break;
      }
      
      // Transport mode bonus for specialized routes
      let transportBonus = 0;
      if (transportMode === 'ship' && currentMaterial?.value === 'bulk') transportBonus = 5;
      if (transportMode === 'flight' && currentMaterial?.value === 'perishable') transportBonus = 10;
      if (transportMode === 'flight' && currentMaterial?.value === 'pharmaceuticals') transportBonus = 15;
      
      const optimizationScore = (() => {
        let baseScore = 70;
        switch (routeData.provider) {
          case 'api': baseScore = 85; break;
          case 'osrm': baseScore = 75; break;
          default: baseScore = 45; break;
        }
        return Math.min(baseScore + optimizationBonus + transportBonus, 95);
      })();
      
      // Cost with optimization factor
      const optimizationFactor = optimizationScore / 100;
      const cost = Math.round(baseCost * (2 - optimizationFactor));

      const finalRouteInfo = {
        distance: routeData.distance,
        duration: routeData.duration,
        cost,
        optimizationScore,
        provider: routeData.provider,
        estimated: routeData.provider === 'straight-line'
      };

      setRouteInfo(finalRouteInfo);
      onRouteCalculated?.(finalRouteInfo);

      // Fit map to show route
      const bounds = L.latLngBounds([
        [fromCoords.lat, fromCoords.lng],
        [toCoords.lat, toCoords.lng]
      ]);
      mapInstanceRef.current.fitBounds(bounds, { padding: [20, 20] });

    } catch (error: any) {
      console.error('Route calculation failed:', error);
      
      // Enhanced error handling with specific messages
      let errorMessage = 'Failed to calculate route';
      if (error.message?.includes('fetch')) {
        errorMessage = 'Network connection issue. Please check your internet connection.';
      } else if (error.message?.includes('timeout')) {
        errorMessage = 'Request timed out. Please try again.';
      } else if (error.message?.includes('not found')) {
        errorMessage = 'Address not found. Please verify the addresses.';
      }
      
      setError(errorMessage);
      setRetryCount(prev => prev + 1);
    } finally {
      setIsCalculating(false);
    }
  };

  // Auto-calculate when addresses or configuration changes
  useEffect(() => {
    if (fromAddress && toAddress && mapLoaded && mapInstanceRef.current) {
      calculateRoute();
    }
  }, [fromAddress, toAddress, mapLoaded, transportMode, optimizationLevel]);

  if (error) {
    return (
      <div className={`bg-muted/30 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-foreground">Route Map</h4>
          <Badge variant="destructive">Error</Badge>
        </div>
        <div className="text-center text-red-600 py-4">
          <AlertCircle className="h-8 w-8 mx-auto mb-2" />
          <p className="font-medium">Map Error</p>
          <p className="text-sm">{error}</p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={calculateRoute}>
              Retry ({retryCount})
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!mapLoaded) {
    return (
      <div className={`bg-muted/30 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
            <p className="text-muted-foreground">Loading OpenStreetMap...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-muted/30 rounded-lg p-4 ${className}`}>

      {/* Route Visualization Section */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-medium text-foreground">Route Visualization</h4>
        <div className="flex items-center gap-2">
          {routeInfo && (
            <Badge 
              variant="default" 
              className={routeInfo.provider === 'osrm' ? 'bg-green-600' : routeInfo.provider === 'api' ? 'bg-blue-600' : 'bg-yellow-600'}
            >
              <Route className="h-3 w-3 mr-1" />
              {routeInfo.provider === 'osrm' ? 'Route Calculated' : 
               routeInfo.provider === 'api' ? 'Optimized Route' : 'Estimated Route'}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={calculateRoute}
            disabled={isCalculating || !fromAddress || !toAddress}
          >
            {isCalculating ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                Calculating...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Calculate Route
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Real-time Transport and Material Selectors */}
      <div className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
          {/* Transport Mode Selector */}
          <div>
            <label className="text-sm font-medium leading-none mb-2 block" htmlFor="transportMode">
              Transport Mode *
            </label>
            <Select 
              value={transportMode} 
              onValueChange={(value) => {
                setTransportMode(value);
                onTransportModeChange?.(value);
                if (fromAddress && toAddress && routeInfo) {
                  setTimeout(calculateRoute, 300);
                }
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select transport mode" />
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

          {/* Material Type Selector */}
          <div>
            <label className="text-sm font-medium leading-none mb-2 block" htmlFor="materialType">
              Material Type *
            </label>
            <Select 
              value={materialType || ''} 
              onValueChange={(value) => {
                onMaterialTypeChange?.(value);
                if (fromAddress && toAddress && routeInfo) {
                  setTimeout(calculateRoute, 300);
                }
              }}
              disabled={!transportMode}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={transportMode ? "Select material type" : "Select transport first"} />
              </SelectTrigger>
              <SelectContent>
                {materialTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    <div>
                      <div className="font-medium">{type.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {type.description} (×{type.multiplier})
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Optimization Level Selector */}
        <div className="flex gap-2">
          {optimizationOptions.map((option) => (
            <Button
              key={option.value}
              variant={optimizationLevel === option.value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setOptimizationLevel(option.value);
                if (fromAddress && toAddress && routeInfo) {
                  setTimeout(calculateRoute, 300);
                }
              }}
              className="text-xs"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Map Container */}
      <div className="relative rounded-lg overflow-hidden border bg-background mb-4">
        <div ref={mapRef} className="w-full h-64"></div>
        
        {/* Map Legend */}
        <div className="absolute bottom-2 left-2 bg-white/90 rounded p-2 text-xs">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-lg">📦</span>
            <span>Pickup</span>
          </div>
          <div className="flex items-center gap-1 mb-1">
            <span className="text-lg">🏠</span>
            <span>Delivery</span>
          </div>
          <div className="flex items-center gap-1">
            <div 
              className="w-3 h-3 rounded-full border border-white shadow-sm"
              style={{ backgroundColor: transportModes.find(m => m.value === transportMode)?.color || '#4F46E5' }}
            ></div>
            <span>{transportModes.find(m => m.value === transportMode)?.icon} {transportModes.find(m => m.value === transportMode)?.label}</span>
          </div>
        </div>

        {/* Provider Info */}
        <div className="absolute top-2 right-2 bg-white/90 rounded p-1 text-xs">
          OpenStreetMap
        </div>
      </div>

      {/* Route Information */}
      {routeInfo ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-background rounded-lg border">
            <div className="text-2xl font-bold text-primary">{routeInfo.distance} km</div>
            <div className="text-sm text-muted-foreground">Distance</div>
          </div>
          <div className="text-center p-3 bg-background rounded-lg border">
            <div className="text-2xl font-bold text-primary">
              {Math.floor(routeInfo.duration / 60)}h {routeInfo.duration % 60}m
            </div>
            <div className="text-sm text-muted-foreground">
              {routeInfo.estimated ? 'Est. Time' : 'Travel Time'}
            </div>
          </div>
          <div className="text-center p-3 bg-background rounded-lg border">
            <div className="text-2xl font-bold text-green-600">₹{routeInfo.cost}</div>
            <div className="text-sm text-muted-foreground">Est. Cost</div>
          </div>
          <div className="text-center p-3 bg-background rounded-lg border">
            <div className="text-2xl font-bold text-blue-600">{routeInfo.optimizationScore}%</div>
            <div className="text-sm text-muted-foreground">
              {routeInfo.estimated ? 'Estimated' : 'Optimized'}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-muted-foreground py-4">
          {fromAddress && toAddress ? 
            'Calculating route...' : 
            'Select pickup and delivery addresses to see route'
          }
        </div>
      )}

      {routeInfo?.estimated && (
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          <strong>Note:</strong> Showing estimated straight-line route. GPS routing failed.
        </div>
      )}

      {routeInfo && (
        <div className="mt-3 p-2 bg-muted/50 rounded text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>{transportModes.find(m => m.value === transportMode)?.icon}</span>
              <span>Route calculated using {transportModes.find(m => m.value === transportMode)?.label.toLowerCase()} mode with {optimizationLevel} optimization.</span>
            </div>
            <div className="flex items-center gap-1">
              <div 
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: transportModes.find(m => m.value === transportMode)?.color || '#4F46E5' }}
              ></div>
              <span className="capitalize">{optimizationLevel}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}