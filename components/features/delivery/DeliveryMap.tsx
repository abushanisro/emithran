'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  MapPin,
  Navigation,
  Truck,
  Package,
  Phone,
  Clock,
  Route,
  Crosshair,
} from 'lucide-react';

// OpenStreetMap with Leaflet - Production ready, open source, scalable
declare global {
  interface Window {
    L: any;
  }
}

interface DeliveryMapProps {
  deliveries: Array<{
    orderId: string;
    orderNumber: string;
    status: string;
    priority: string;
    customer: {
      name: string;
      phone: string;
      address: string;
    };
    origin: { lat: number; lng: number; address: string };
    destination: { lat: number; lng: number; address: string };
    currentLocation?: { lat: number; lng: number; timestamp: string };
    carrier: {
      name: string;
      trackingNumber: string;
      driverName?: string;
      driverPhone?: string;
    };
  }>;
  selectedDelivery?: any;
  onLocationUpdate?: (orderId: string, location: { lat: number; lng: number; status?: string; notes?: string }) => void;
  onDeliverySelect?: (delivery: any) => void;
}

export default function DeliveryMap({ 
  deliveries, 
  selectedDelivery, 
  onLocationUpdate, 
  onDeliverySelect 
}: DeliveryMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const routeLayerRef = useRef<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isLoadingRoute, setIsLoadingRoute] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Load Leaflet CSS and JS
  useEffect(() => {
    const loadLeaflet = async () => {
      if (typeof window !== 'undefined' && !window.L) {
        // Load CSS
        const cssLink = document.createElement('link');
        cssLink.rel = 'stylesheet';
        cssLink.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        cssLink.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
        cssLink.crossOrigin = '';
        document.head.appendChild(cssLink);

        // Load JS
        return new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
          script.crossOrigin = '';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
    };

    loadLeaflet()
      .then(() => setMapLoaded(true))
      .catch(error => console.error('Failed to load Leaflet:', error));
  }, []);

  // Get user's current location
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.warn('Geolocation error:', error);
          // Default to Delhi/NCR center
          setUserLocation({ lat: 28.6139, lng: 77.2090 });
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    } else {
      setUserLocation({ lat: 28.6139, lng: 77.2090 });
    }
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !window.L || !userLocation || mapInstanceRef.current) {
      return;
    }

    try {
      // Initialize map
      const map = window.L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([userLocation.lat, userLocation.lng], 10);

      // Add OpenStreetMap tiles (free, no API key required)
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      // Custom icon styles for different delivery statuses
      const createCustomIcon = (status: string, type: 'origin' | 'destination' | 'current' = 'current') => {
        const colors = {
          origin: '#22c55e', // green
          destination: '#ef4444', // red
          pending: '#6b7280', // gray
          pickup: '#3b82f6', // blue
          in_transit: '#f59e0b', // yellow
          out_for_delivery: '#f97316', // orange
          delivered: '#22c55e', // green
          failed: '#ef4444', // red
        };

        const color = type === 'origin' ? colors.origin : 
                     type === 'destination' ? colors.destination : 
                     colors[status as keyof typeof colors] || colors.pending;

        const iconHtml = type === 'origin' ? '📦' : 
                        type === 'destination' ? '🏠' : '🚚';

        return window.L.divIcon({
          className: 'custom-div-icon',
          html: `
            <div style="
              background-color: ${color};
              width: 25px;
              height: 25px;
              border-radius: 50%;
              border: 3px solid white;
              display: flex;
              align-items: center;
              justify-content: center;
              box-shadow: 0 2px 5px rgba(0,0,0,0.3);
              font-size: 12px;
            ">
              ${iconHtml}
            </div>
          `,
          iconSize: [25, 25],
          iconAnchor: [12, 12],
        });
      };

      mapInstanceRef.current = map;

      // Add click handler for updating delivery locations
      map.on('click', (e: any) => {
        if (selectedDelivery && onLocationUpdate) {
          const { lat, lng } = e.latlng;
          onLocationUpdate(selectedDelivery.orderId, {
            lat: lat,
            lng: lng,
            status: 'location_update',
            notes: `Manual location update at ${new Date().toLocaleString()}`
          });
        }
      });

    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }, [mapLoaded, userLocation, selectedDelivery, onLocationUpdate]);

  // Update markers when deliveries change
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L) return;

    // Clear existing markers
    markersRef.current.forEach(marker => mapInstanceRef.current.removeLayer(marker));
    markersRef.current = [];

    // Add markers for each delivery
    deliveries.forEach(delivery => {
      const markers: any[] = [];

      // Origin marker
      const originMarker = window.L.marker(
        [delivery.origin.lat, delivery.origin.lng],
        { icon: createCustomIcon(delivery.status, 'origin') }
      )
        .addTo(mapInstanceRef.current)
        .bindPopup(`
          <div style="min-width: 200px;">
            <h3 style="margin: 0 0 8px 0; font-weight: bold;">Origin</h3>
            <p style="margin: 0 0 4px 0;"><strong>Order:</strong> ${delivery.orderNumber}</p>
            <p style="margin: 0 0 4px 0;"><strong>Address:</strong> ${delivery.origin.address}</p>
            <p style="margin: 0;"><strong>Carrier:</strong> ${delivery.carrier.name}</p>
          </div>
        `);
      
      markers.push(originMarker);

      // Destination marker
      const destinationMarker = window.L.marker(
        [delivery.destination.lat, delivery.destination.lng],
        { icon: createCustomIcon(delivery.status, 'destination') }
      )
        .addTo(mapInstanceRef.current)
        .bindPopup(`
          <div style="min-width: 200px;">
            <h3 style="margin: 0 0 8px 0; font-weight: bold;">Destination</h3>
            <p style="margin: 0 0 4px 0;"><strong>Customer:</strong> ${delivery.customer.name}</p>
            <p style="margin: 0 0 4px 0;"><strong>Phone:</strong> ${delivery.customer.phone}</p>
            <p style="margin: 0 0 8px 0;"><strong>Address:</strong> ${delivery.customer.address}</p>
            <button onclick="window.open('tel:${delivery.customer.phone}')" style="
              background: #3b82f6;
              color: white;
              border: none;
              padding: 4px 8px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
            ">Call Customer</button>
          </div>
        `);
      
      markers.push(destinationMarker);

      // Current location marker (if available)
      if (delivery.currentLocation) {
        const currentMarker = window.L.marker(
          [delivery.currentLocation.lat, delivery.currentLocation.lng],
          { icon: createCustomIcon(delivery.status) }
        )
          .addTo(mapInstanceRef.current)
          .bindPopup(`
            <div style="min-width: 200px;">
              <h3 style="margin: 0 0 8px 0; font-weight: bold;">Current Location</h3>
              <p style="margin: 0 0 4px 0;"><strong>Order:</strong> ${delivery.orderNumber}</p>
              <p style="margin: 0 0 4px 0;"><strong>Status:</strong> ${delivery.status.replace('_', ' ')}</p>
              <p style="margin: 0 0 4px 0;"><strong>Driver:</strong> ${delivery.carrier.driverName || 'N/A'}</p>
              ${delivery.carrier.driverPhone ? `
                <button onclick="window.open('tel:${delivery.carrier.driverPhone}')" style="
                  background: #22c55e;
                  color: white;
                  border: none;
                  padding: 4px 8px;
                  border-radius: 4px;
                  cursor: pointer;
                  font-size: 12px;
                ">Call Driver</button>
              ` : ''}
              <p style="margin: 4px 0 0 0; font-size: 11px; color: #666;">
                Updated: ${new Date(delivery.currentLocation.timestamp).toLocaleString()}
              </p>
            </div>
          `);
        
        markers.push(currentMarker);
      }

      // Add click handlers for delivery selection
      markers.forEach(marker => {
        marker.on('click', () => {
          onDeliverySelect?.(delivery);
        });
      });

      markersRef.current.push(...markers);
    });

    // Fit map to show all markers if there are deliveries
    if (deliveries.length > 0 && markersRef.current.length > 0) {
      const group = new window.L.featureGroup(markersRef.current);
      mapInstanceRef.current.fitBounds(group.getBounds().pad(0.1));
    }

  }, [deliveries, onDeliverySelect]);

  // Draw route for selected delivery
  useEffect(() => {
    if (!mapInstanceRef.current || !window.L || !selectedDelivery) return;

    const drawRoute = async () => {
      try {
        setIsLoadingRoute(true);

        // Remove existing route
        if (routeLayerRef.current) {
          mapInstanceRef.current.removeLayer(routeLayerRef.current);
        }

        const start = selectedDelivery.currentLocation || selectedDelivery.origin;
        const end = selectedDelivery.destination;

        // Use OSRM (Open Source Routing Machine) for route calculation
        // This is free and doesn't require API keys
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch route');
        }

        const data = await response.json();

        if (data.routes && data.routes.length > 0) {
          const route = data.routes[0];
          const coordinates = route.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);

          // Draw route line
          routeLayerRef.current = window.L.polyline(coordinates, {
            color: selectedDelivery.status === 'delivered' ? '#22c55e' : 
                   selectedDelivery.status === 'failed' ? '#ef4444' : '#3b82f6',
            weight: 4,
            opacity: 0.8,
            dashArray: selectedDelivery.status === 'delivered' ? null : '10, 5'
          }).addTo(mapInstanceRef.current);

          // Add route info popup
          const midpoint = coordinates[Math.floor(coordinates.length / 2)];
          const duration = Math.round(route.duration / 60); // minutes
          const distance = (route.distance / 1000).toFixed(1); // km

          window.L.popup()
            .setLatLng(midpoint)
            .setContent(`
              <div style="text-align: center;">
                <strong>Route Info</strong><br>
                Distance: ${distance} km<br>
                Est. Time: ${duration} min
              </div>
            `)
            .openOn(mapInstanceRef.current);

          // Fit map to route
          mapInstanceRef.current.fitBounds(routeLayerRef.current.getBounds().pad(0.1));
        }
      } catch (error) {
        console.error('Error drawing route:', error);
      } finally {
        setIsLoadingRoute(false);
      }
    };

    drawRoute();
  }, [selectedDelivery]);

  const createCustomIcon = (status: string, type: 'origin' | 'destination' | 'current' = 'current') => {
    const colors = {
      origin: '#22c55e',
      destination: '#ef4444',
      pending: '#6b7280',
      pickup: '#3b82f6',
      in_transit: '#f59e0b',
      out_for_delivery: '#f97316',
      delivered: '#22c55e',
      failed: '#ef4444',
    };

    const color = type === 'origin' ? colors.origin : 
                 type === 'destination' ? colors.destination : 
                 colors[status as keyof typeof colors] || colors.pending;

    const iconHtml = type === 'origin' ? '📦' : 
                    type === 'destination' ? '🏠' : '🚚';

    return window.L.divIcon({
      className: 'custom-div-icon',
      html: `
        <div style="
          background-color: ${color};
          width: 25px;
          height: 25px;
          border-radius: 50%;
          border: 3px solid white;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 5px rgba(0,0,0,0.3);
          font-size: 12px;
        ">
          ${iconHtml}
        </div>
      `,
      iconSize: [25, 25],
      iconAnchor: [12, 12],
    });
  };

  const centerOnUser = () => {
    if (mapInstanceRef.current && userLocation) {
      mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], 15);
    }
  };

  const centerOnDelivery = () => {
    if (mapInstanceRef.current && selectedDelivery) {
      const location = selectedDelivery.currentLocation || selectedDelivery.destination;
      mapInstanceRef.current.setView([location.lat, location.lng], 15);
    }
  };

  if (!mapLoaded) {
    return (
      <div className="h-96 bg-muted rounded-lg flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-muted-foreground">Loading map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-96 w-full rounded-lg overflow-hidden border">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* Map Controls */}
      <div className="absolute top-4 right-4 space-y-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={centerOnUser}
          className="shadow-md"
          title="Center on your location"
        >
          <Crosshair className="h-4 w-4" />
        </Button>
        
        {selectedDelivery && (
          <Button
            size="sm"
            variant="secondary"
            onClick={centerOnDelivery}
            className="shadow-md"
            title="Center on selected delivery"
          >
            <Navigation className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Loading indicator for route */}
      {isLoadingRoute && (
        <div className="absolute bottom-4 left-4 bg-white rounded-lg p-2 shadow-md">
          <div className="flex items-center gap-2 text-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
            <span>Calculating route...</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 right-4 bg-white rounded-lg p-3 shadow-md max-w-xs">
        <h4 className="font-medium text-sm mb-2">Map Legend</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-white text-xs">📦</span>
            <span>Origin/Warehouse</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white text-xs">🏠</span>
            <span>Customer/Destination</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs">🚚</span>
            <span>Current Vehicle Location</span>
          </div>
          {selectedDelivery && (
            <div className="mt-2 pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Click on map to update delivery location
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}