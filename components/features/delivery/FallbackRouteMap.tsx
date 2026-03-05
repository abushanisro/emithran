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
  materialType: externalMaterialType,
  onRouteCalculated,
  onTransportModeChange,
  onMaterialTypeChange,
  className = ''
}: FallbackRouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const calculateRouteRef = useRef<() => Promise<void>>(async () => { });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeInfo, setRouteInfo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [transportMode, setTransportMode] = useState<string>(externalTransportMode || 'car');
  const [materialType, setMaterialType] = useState<string>(externalMaterialType || 'general');
  const [optimizationLevel, setOptimizationLevel] = useState<string>('balanced');

  // Sync internal state when external props change
  useEffect(() => {
    if (externalTransportMode) setTransportMode(externalTransportMode);
  }, [externalTransportMode]);

  useEffect(() => {
    if (externalMaterialType) setMaterialType(externalMaterialType);
  }, [externalMaterialType]);

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
    { value: 'general', label: 'General Goods', multiplier: 1.00, description: 'Standard materials' },
    { value: 'wooden_box', label: 'Wooden Box / Crate', multiplier: 1.10, description: 'Wooden packaging, moderate care' },
    { value: 'metal_box', label: 'Metal Box / Container', multiplier: 1.20, description: 'Heavy metal containers' },
    { value: 'fragile', label: 'Fragile Items', multiplier: 1.50, description: 'Requires careful handling' },
    { value: 'hazardous', label: 'Hazardous Materials', multiplier: 2.20, description: 'Special safety requirements' },
    { value: 'perishable', label: 'Perishable Goods', multiplier: 1.35, description: 'Temperature controlled' },
    { value: 'bulk', label: 'Bulk Materials', multiplier: 0.85, description: 'Large volume discount' },
    { value: 'electronics', label: 'Electronics', multiplier: 1.45, description: 'Anti-static handling' },
    { value: 'pharmaceuticals', label: 'Pharmaceuticals', multiplier: 1.90, description: 'Cold chain required' },
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

  // Main route calculation function — delegates EVERYTHING to the API.
  // No local cost/score mocks. The API is the single source of truth.
  const calculateRoute = async () => {
    if (!fromAddress || !toAddress || !mapInstanceRef.current) return;

    // Validate required address fields
    const requiredFields = ['addressLine1', 'city', 'stateProvince', 'postalCode', 'country'];
    const missingFromFields = requiredFields.filter(field => !fromAddress[field]);
    const missingToFields = requiredFields.filter(field => !toAddress[field]);

    if (missingFromFields.length > 0) {
      setError(`From address is missing: ${missingFromFields.join(', ')}`);
      return;
    }
    if (missingToFields.length > 0) {
      setError(`To address is missing: ${missingToFields.join(', ')}`);
      return;
    }

    if (!transportMode) {
      setError('Transport mode is not selected');
      return;
    }

    setIsCalculating(true);
    setError(null);

    try {
      const formatAddress = (address: any) => {
        const parts = [
          address.addressLine1,
          address.addressLine2,
          address.city,
          address.stateProvince,
          address.postalCode,
          address.country
        ].filter(part => part && part.trim() !== '').map(part => part.trim());

        return parts.join(', ');
      };

      const fromAddressString = formatAddress(fromAddress);
      const toAddressString = formatAddress(toAddress);

      console.log('Route calculation request:', {
        fromAddress: fromAddressString,
        toAddress: toAddressString,
        transportMode,
        optimizationLevel,
        materialType: materialType || 'general',
      });

      const res = await fetch('/api/route-calculation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAddress: fromAddressString,
          toAddress: toAddressString,
          transportMode,
          optimizationLevel,
          materialType: materialType || 'general',
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('Route calculation API error:', res.status, err);
        throw new Error(err.error || `Route calculation failed (${res.status})`);
      }

      const data = await res.json();
      const fromCoords = data.fromCoords;
      const toCoords = data.toCoords;

      // ── Draw on map ───────────────────────────────────────────────────────
      // Clear previous route layers (keep tile layer)
      mapInstanceRef.current.eachLayer((layer: any) => {
        if (layer._url === undefined) { // not a tile layer
          mapInstanceRef.current.removeLayer(layer);
        }
      });

      const selectedTransport = transportModes.find(m => m.value === transportMode);
      const transportIcon = selectedTransport?.icon || '🚗';
      const routeColor = selectedTransport?.color || '#4F46E5';

      // Marker factory
      const makeMarker = (bg: string, emoji: string) => L.divIcon({
        className: 'custom-div-icon',
        html: `
          <div style="
            background:${bg};width:36px;height:36px;border-radius:50%;
            border:3px solid white;display:flex;align-items:center;
            justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.3);font-size:16px;
          ">${emoji}</div>
          <div style="
            position:absolute;bottom:-8px;right:-8px;
            background:${routeColor};width:20px;height:20px;border-radius:50%;
            border:2px solid white;display:flex;align-items:center;
            justify-content:center;font-size:10px;box-shadow:0 2px 4px rgba(0,0,0,.2);
          ">${transportIcon}</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      });

      L.marker([fromCoords.lat, fromCoords.lng], { icon: makeMarker('#22c55e', '📦') })
        .addTo(mapInstanceRef.current)
        .bindPopup(`<b>Pickup</b><br>${fromAddress.addressLine1}<br>${fromAddress.city}`);

      L.marker([toCoords.lat, toCoords.lng], { icon: makeMarker('#ef4444', '🏠') })
        .addTo(mapInstanceRef.current)
        .bindPopup(`<b>Delivery</b><br>${toAddress.addressLine1}<br>${toAddress.city}`);

      // Try to draw a real road polyline via OSRM
      const isSpecial = transportMode === 'ship' || transportMode === 'flight';
      let polylineCoords: [number, number][] = [];
      let lineStyle = { color: routeColor, weight: 4, opacity: 0.8, dashArray: undefined as string | undefined };

      if (!isSpecial) {
        try {
          const osrmProfile = transportMode === 'bike' ? 'bicycle' : transportMode === 'walking' ? 'foot' : 'driving';
          const osrmRes = await fetch(
            `https://router.project-osrm.org/route/v1/${osrmProfile}/${fromCoords.lng},${fromCoords.lat};${toCoords.lng},${toCoords.lat}?overview=full&geometries=geojson`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (osrmRes.ok) {
            const osrmData = await osrmRes.json();
            if (osrmData.routes?.length > 0) {
              polylineCoords = osrmData.routes[0].geometry.coordinates.map((c: number[]) => [c[1], c[0]] as [number, number]);
            }
          }
        } catch { /* fall through to straight line */ }
      }

      if (polylineCoords.length === 0) {
        // Straight line (ship/flight or OSRM failed)
        polylineCoords = [[fromCoords.lat, fromCoords.lng], [toCoords.lat, toCoords.lng]];
        lineStyle = { color: isSpecial ? routeColor : '#f59e0b', weight: 3, opacity: 0.7, dashArray: '8 6' };
      }

      if (transportMode === 'walking') lineStyle.dashArray = '10 5';
      if (transportMode === 'truck') lineStyle.weight = 6;

      L.polyline(polylineCoords, lineStyle).addTo(mapInstanceRef.current);

      // Fit map bounds
      mapInstanceRef.current.fitBounds(
        L.latLngBounds([[fromCoords.lat, fromCoords.lng], [toCoords.lat, toCoords.lng]]),
        { padding: [40, 40] }
      );

      // ── Store result (everything comes from API, no mock values) ──────────
      setRouteInfo({
        distance: data.distance,
        duration: data.duration,
        cost: data.cost,
        costBreakdown: data.costBreakdown,
        dataQualityScore: data.dataQualityScore,
        routeProvider: data.routeProvider,
        isEstimated: data.isEstimated,
        transportMode: data.transportMode,
        materialType: data.materialType,
        optimizationLevel: data.optimizationLevel,
      });
      onRouteCalculated?.(data);

    } catch (err: any) {
      setError(err.message || 'Failed to calculate route');
      setRetryCount(p => p + 1);
    } finally {
      setIsCalculating(false);
    }
  };

  // Keep ref always pointing to the latest calculateRoute
  calculateRouteRef.current = calculateRoute;

  // Debounced trigger so rapid dropdown changes don't spam API calls
  const triggerCalculation = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      calculateRouteRef.current();
    }, 400);
  };

  // Auto-calculate when addresses, transport mode, material type, or optimization changes
  useEffect(() => {
    if (fromAddress && toAddress && mapLoaded && mapInstanceRef.current) {
      triggerCalculation();
    }
  }, [fromAddress, toAddress, mapLoaded, transportMode, materialType, optimizationLevel]);

  if (error) {
    return (
      <div className={`bg-muted/30 rounded-lg p-4 ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-medium text-foreground">Route Map</h4>
          <Badge variant="destructive">Error</Badge>
        </div>
        <div className="text-center text-destructive py-4">
          <AlertCircle className="h-8 w-8 mx-auto mb-2" />
          <p className="font-medium">Route Error</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
          <div className="flex gap-2 justify-center mt-3">
            <Button variant="outline" size="sm" onClick={calculateRoute}>Retry ({retryCount})</Button>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>Dismiss</Button>
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
            <p className="text-muted-foreground">Loading map…</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedTransport = transportModes.find(m => m.value === transportMode);

  // Provider display metadata
  const providerMeta: Record<string, { label: string; color: string }> = {
    osrm: { label: 'Real Road Route', color: 'bg-green-600' },
    google: { label: 'Google-Verified Route', color: 'bg-blue-600' },
    'maritime-haversine': { label: 'Maritime Estimate', color: 'bg-sky-600' },
    'aviation-haversine': { label: 'Aviation Estimate', color: 'bg-indigo-600' },
    estimated: { label: 'Estimated Route', color: 'bg-amber-600' },
  };
  const providerDisplay = routeInfo ? (providerMeta[routeInfo.routeProvider] ?? { label: 'Calculated Route', color: 'bg-slate-600' }) : null;

  return (
    <div className={`bg-muted/30 rounded-lg p-4 ${className}`}>

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-medium text-foreground flex items-center gap-2">
          <Route className="h-4 w-4" />
          Route Visualization
        </h4>
        <div className="flex items-center gap-2">
          {routeInfo && providerDisplay && (
            <Badge className={`${providerDisplay.color} text-white text-xs`}>
              <Route className="h-3 w-3 mr-1" />
              {providerDisplay.label}
            </Badge>
          )}
          <Button
            variant="outline" size="sm"
            onClick={() => calculateRouteRef.current()}
            disabled={isCalculating || !fromAddress || !toAddress}
          >
            {isCalculating ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2" />Calculating…</>
            ) : (
              <><RefreshCw className="h-4 w-4 mr-2" />Recalculate</>
            )}
          </Button>
        </div>
      </div>

      {/* Selectors */}
      <div className="mb-4 relative z-50">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="text-sm font-medium leading-none mb-2 block" htmlFor="transportMode">
              Transport Mode *
            </label>
            <Select
              value={transportMode}
              onValueChange={(value) => {
                setTransportMode(value);
                onTransportModeChange?.(value);
                triggerCalculation();
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select transport mode" />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4} className="z-[9999]">
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
            <label className="text-sm font-medium leading-none mb-2 block" htmlFor="materialType">
              Material Type *
            </label>
            <Select
              value={materialType}
              onValueChange={(value) => {
                setMaterialType(value);
                onMaterialTypeChange?.(value);
                triggerCalculation();
              }}
              disabled={!transportMode}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={transportMode ? 'Select material type' : 'Select transport first'} />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4} className="z-[9999]">
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

        <div className="flex gap-2">
          {optimizationOptions.map((option) => (
            <Button
              key={option.value}
              variant={optimizationLevel === option.value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => { setOptimizationLevel(option.value); triggerCalculation(); }}
              className="text-xs"
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div className="relative z-10 rounded-lg overflow-hidden border bg-background mb-4">
        <div ref={mapRef} className="w-full h-64" />
        <div className="absolute bottom-2 left-2 bg-background/90 border rounded p-2 text-xs space-y-1">
          <div className="flex items-center gap-1"><span>📦</span><span>Pickup</span></div>
          <div className="flex items-center gap-1"><span>🏠</span><span>Delivery</span></div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedTransport?.color || '#4F46E5' }} />
            <span>{selectedTransport?.icon} {selectedTransport?.label}</span>
          </div>
        </div>
        <div className="absolute top-2 right-2 bg-background/90 border rounded px-2 py-1 text-xs text-muted-foreground">
          OpenStreetMap
        </div>
      </div>

      {/* Metrics */}
      {isCalculating ? (
        <div className="flex items-center justify-center h-32 bg-background rounded-lg border">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
            <p className="text-muted-foreground">Calculating route...</p>
          </div>
        </div>
      ) : routeInfo ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div className="text-center p-3 bg-background rounded-lg border">
              <div className="text-2xl font-bold text-primary">{routeInfo.distance} km</div>
              <div className="text-xs text-muted-foreground mt-1">
                {routeInfo.isEstimated ? 'Est. Distance' : 'Road Distance'}
              </div>
            </div>
            <div className="text-center p-3 bg-background rounded-lg border">
              <div className="text-2xl font-bold text-primary">
                {routeInfo.duration >= 60
                  ? `${Math.floor(routeInfo.duration / 60)}h ${routeInfo.duration % 60}m`
                  : `${routeInfo.duration}m`}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {routeInfo.isEstimated ? 'Est. Time' : 'Travel Time'}
              </div>
            </div>
            <div className="text-center p-3 bg-background rounded-lg border">
              <div className="text-2xl font-bold text-emerald-500">₹{routeInfo.cost.toLocaleString('en-IN')}</div>
              <div className="text-xs text-muted-foreground mt-1">Total Est. Cost</div>
            </div>
            <div className="text-center p-3 bg-background rounded-lg border">
              <div className="text-2xl font-bold text-sky-500">{routeInfo.dataQualityScore}%</div>
              <div className="text-xs text-muted-foreground mt-1">Data Quality</div>
            </div>
          </div>

          {/* Cost Breakdown */}
          {routeInfo.costBreakdown && (() => {
            const activeMaterial = materialTypes.find(m => m.value === (routeInfo.materialType || materialType || 'general'));
            return (
              <div className="bg-background border rounded-lg p-3 mb-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Cost Breakdown</p>

                {/* Selected configuration chips */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    {selectedTransport?.icon} {selectedTransport?.label}
                  </span>
                  {activeMaterial && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                      📦 {activeMaterial.label} ×{activeMaterial.multiplier}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                    {routeInfo.optimizationLevel || optimizationLevel}
                  </span>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transport ({routeInfo.distance} km × ₹{selectedTransport?.costPerKm}/km)</span>
                    <span>₹{routeInfo.costBreakdown.transportBase.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Loading & Unloading</span>
                    <span>₹{routeInfo.costBreakdown.loadingUnloading.toLocaleString('en-IN')}</span>
                  </div>
                  {routeInfo.costBreakdown.materialSurcharge > 0 && activeMaterial && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {activeMaterial.label} surcharge (×{activeMaterial.multiplier} − 1)
                      </span>
                      <span>₹{routeInfo.costBreakdown.materialSurcharge.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {routeInfo.costBreakdown.fuelTollSurcharge > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fuel & Toll (6%)</span>
                      <span>₹{routeInfo.costBreakdown.fuelTollSurcharge.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                    <span>Total</span>
                    <span className="text-emerald-500">₹{routeInfo.cost.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Estimated route notice */}
          {routeInfo.isEstimated && (
            <div className="p-2 bg-warning/10 border border-warning/30 rounded text-xs text-warning flex items-start gap-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>Estimated route:</strong> Real road routing is unavailable. Distance uses a 1.3× road-factor applied to straight-line (Haversine) distance. Actual costs may vary.
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="text-center text-muted-foreground py-6">
          <div className="text-lg">No route calculated yet</div>
          <div className="text-sm mt-1">
            {fromAddress && toAddress
              ? 'Route will be calculated automatically'
              : 'Select pickup and delivery addresses to see route'
            }
          </div>
        </div>
      )}
    </div>
  );
}