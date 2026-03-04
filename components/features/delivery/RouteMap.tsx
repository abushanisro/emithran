'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Route, RefreshCw } from 'lucide-react';
import FallbackRouteMap from './FallbackRouteMap';

interface RouteMapProps {
  fromAddress?: any;
  toAddress?: any;
  transportMode?: string;
  materialType?: string;
  onRouteCalculated?: (result: any) => void;
  onTransportModeChange?: (mode: string) => void;
  onMaterialTypeChange?: (type: string) => void;
  className?: string;
}

declare global {
  interface Window {
    google: any;
  }
}

export default function RouteMap({ fromAddress, toAddress, transportMode, materialType, onRouteCalculated, onTransportModeChange, onMaterialTypeChange, className = '' }: RouteMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const directionsServiceRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [googleMapsFailed, setGoogleMapsFailed] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeInfo, setRouteInfo] = useState<any>(null);

  // Load Google Maps script
  useEffect(() => {
    const loadGoogleMaps = () => {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

      if (!apiKey) {
        console.warn('Google Maps API key not found');
        setMapLoaded(false);
        return;
      }

      if (window.google && window.google.maps) {
        setMapLoaded(true);
        return;
      }

      // Check if script already exists
      if (document.querySelector('script[src*="maps.googleapis.com"]')) {
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry&loading=async`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        console.log('Google Maps loaded successfully');
        setMapLoaded(true);
      };

      script.onerror = (error) => {
        console.error('Failed to load Google Maps script:', error);
        console.error('API Key:', apiKey ? 'Present' : 'Missing');
        setMapLoaded(false);
        setGoogleMapsFailed(true);
      };

      document.head.appendChild(script);
    };

    loadGoogleMaps();
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !window.google || mapInstanceRef.current) {
      return;
    }

    try {
      // Initialize map centered on Delhi/NCR
      const map = new window.google.maps.Map(mapRef.current, {
        zoom: 10,
        center: { lat: 28.6139, lng: 77.2090 }, // Delhi center
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
      });

      // Initialize directions service and renderer
      directionsServiceRef.current = new window.google.maps.DirectionsService();
      directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
        map: map,
        panel: null,
        suppressMarkers: false,
        polylineOptions: {
          strokeColor: '#4F46E5',
          strokeWeight: 4,
          strokeOpacity: 0.8,
        }
      });

      mapInstanceRef.current = map;
    } catch (error) {
      console.error('Error initializing Google Maps:', error);
    }
  }, [mapLoaded]);

  // Calculate and display route
  const calculateRoute = async () => {
    if (!fromAddress || !toAddress || !directionsServiceRef.current || !directionsRendererRef.current) {
      return;
    }

    setIsCalculating(true);

    try {
      // Build address strings
      const fromAddressString = `${fromAddress.addressLine1}, ${fromAddress.city}, ${fromAddress.stateProvince}, ${fromAddress.country}`;
      const toAddressString = `${toAddress.addressLine1}, ${toAddress.city}, ${toAddress.stateProvince}, ${toAddress.country}`;

      const request = {
        origin: fromAddressString,
        destination: toAddressString,
        travelMode: window.google.maps.TravelMode.DRIVING,
        unitSystem: window.google.maps.UnitSystem.METRIC,
        avoidHighways: false,
        avoidTolls: false,
      };

      directionsServiceRef.current.route(request, (result: any, status: any) => {
        if (status === 'OK') {
          // Display route on map
          directionsRendererRef.current.setDirections(result);

          // Extract route information
          const route = result.routes[0];
          const leg = route.legs[0];

          const routeData = {
            distance: (leg.distance.value / 1000).toFixed(1), // Convert to km
            duration: Math.round(leg.duration.value / 60), // Convert to minutes
            distanceText: leg.distance.text,
            durationText: leg.duration.text,
            startAddress: leg.start_address,
            endAddress: leg.end_address,
            optimizationScore: 85, // Google routes are well optimized
            cost: Math.round(leg.distance.value / 1000 * 8) // ₹8 per km for car
          };

          setRouteInfo(routeData);
          onRouteCalculated?.(routeData);

          // Fit map to route bounds
          if (mapInstanceRef.current) {
            mapInstanceRef.current.fitBounds(route.bounds);
          }
        } else {
          console.error('Directions request failed due to ' + status);

          // Fallback: Show markers for start and end points
          showMarkersOnly(fromAddressString, toAddressString);
        }
      });
    } catch (error) {
      console.error('Error calculating route:', error);
    } finally {
      setIsCalculating(false);
    }
  };

  // Fallback: Show only start/end markers without route
  const showMarkersOnly = async (fromAddr: string, toAddr: string) => {
    const geocoder = new window.google.maps.Geocoder();

    try {
      // Geocode start address
      const fromResult = await new Promise((resolve, reject) => {
        geocoder.geocode({ address: fromAddr }, (results: any, status: any) => {
          if (status === 'OK') resolve(results[0]);
          else reject(status);
        });
      });

      // Geocode end address  
      const toResult = await new Promise((resolve, reject) => {
        geocoder.geocode({ address: toAddr }, (results: any, status: any) => {
          if (status === 'OK') resolve(results[0]);
          else reject(status);
        });
      });

      // Add markers
      new window.google.maps.Marker({
        position: (fromResult as any).geometry.location,
        map: mapInstanceRef.current,
        title: 'Pickup Location',
        icon: {
          url: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiMyMmM1NWUiLz4KPHN2ZyB4PSI2IiB5PSI2IiB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0ibTcgNyAxMC0xMC0xMCAxMFoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo8L3N2Zz4K',
          scaledSize: new window.google.maps.Size(30, 30)
        }
      });

      new window.google.maps.Marker({
        position: (toResult as any).geometry.location,
        map: mapInstanceRef.current,
        title: 'Delivery Location',
        icon: {
          url: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiIGZpbGw9IiNlZjQ0NDQiLz4KPHN2ZyB4PSI2IiB5PSI2IiB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0ibTcgNyAxMC0xMC0xMCAxMFoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo8L3N2Zz4K',
          scaledSize: new window.google.maps.Size(30, 30)
        }
      });

      // Calculate straight-line distance
      const distance = window.google.maps.geometry.spherical.computeDistanceBetween(
        (fromResult as any).geometry.location,
        (toResult as any).geometry.location
      );

      const estimatedRouteData = {
        distance: (distance / 1000).toFixed(1),
        duration: Math.round(distance / 1000 / 40 * 60), // Assume 40 km/h average
        distanceText: `${(distance / 1000).toFixed(1)} km`,
        durationText: `${Math.round(distance / 1000 / 40 * 60)} min`,
        startAddress: fromAddr,
        endAddress: toAddr,
        optimizationScore: 50,
        cost: Math.round(distance / 1000 * 8),
        estimated: true
      };

      setRouteInfo(estimatedRouteData);
      onRouteCalculated?.(estimatedRouteData);

      // Fit map to show both markers
      const bounds = new window.google.maps.LatLngBounds();
      bounds.extend((fromResult as any).geometry.location);
      bounds.extend((toResult as any).geometry.location);
      mapInstanceRef.current.fitBounds(bounds);

    } catch (error) {
      console.error('Error showing markers:', error);
    }
  };

  // Auto-calculate when addresses change
  useEffect(() => {
    if (fromAddress && toAddress && mapLoaded && directionsServiceRef.current) {
      calculateRoute();
    }
  }, [fromAddress, toAddress, mapLoaded]);

  // If Google Maps failed or no API key, use fallback
  if (googleMapsFailed || !process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || !mapLoaded) {
    return (
      <FallbackRouteMap
        fromAddress={fromAddress}
        toAddress={toAddress}
        transportMode={transportMode}
        materialType={materialType}
        onRouteCalculated={onRouteCalculated}
        onTransportModeChange={onTransportModeChange}
        onMaterialTypeChange={onMaterialTypeChange}
        className={className}
      />
    );
  }

  return (
    <div className={`bg-muted/30 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h4 className="font-medium text-foreground">Distance & Time Estimation</h4>
        <div className="flex items-center gap-2">
          {routeInfo && (
            <Badge variant="default" className="bg-green-600">
              <Route className="h-3 w-3 mr-1" />
              Route Calculated
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

      {/* Map Container */}
      <div className="relative rounded-lg overflow-hidden border bg-background mb-4">
        <div ref={mapRef} className="w-full h-64"></div>

        {/* Map Legend */}
        <div className="absolute bottom-2 left-2 bg-white/90 rounded p-2 text-xs">
          <div className="flex items-center gap-1 mb-1">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <span>Pickup</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <span>Delivery</span>
          </div>
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
            'Click "Calculate Route" to see route on map' :
            'Select pickup and delivery addresses to calculate route'
          }
        </div>
      )}

      {routeInfo?.estimated && (
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          <strong>Note:</strong> Showing estimated straight-line distance. Enable Google Directions API for accurate route.
        </div>
      )}
    </div>
  );
}