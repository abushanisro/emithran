'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

interface StateData {
  [key: string]: number;
}

interface IndiaMapProps {
  stateData: StateData;
  className?: string;
  showLegend?: boolean;
}

// City coordinates for Indian cities
const CITY_COORDINATES: { [key: string]: { lat: number; lng: number } } = {
  'Bengaluru': { lat: 12.9716, lng: 77.5946 },
  'Bangalore': { lat: 12.9716, lng: 77.5946 },
  'Chennai': { lat: 13.0827, lng: 80.2707 },
  'Mumbai': { lat: 19.0760, lng: 72.8777 },
  'Pune': { lat: 18.5204, lng: 73.8567 },
  'Hyderabad': { lat: 17.3850, lng: 78.4867 },
  'Kolkata': { lat: 22.5726, lng: 88.3639 },
  'Ahmedabad': { lat: 23.0225, lng: 72.5714 },
  'Rajkot': { lat: 22.3039, lng: 70.8022 },
  'Veraval': { lat: 20.9074, lng: 70.3676 },
  'Shapar': { lat: 22.7167, lng: 70.6167 },
  'Delhi': { lat: 28.7041, lng: 77.1025 },
  'New Delhi': { lat: 28.6139, lng: 77.2090 },
  'Gurugram': { lat: 28.4595, lng: 77.0266 },
  'Gurgaon': { lat: 28.4595, lng: 77.0266 },
  'Kolhapur': { lat: 16.7050, lng: 74.2433 },
  'Miraj': { lat: 16.8270, lng: 74.6453 },
  'Ambernath': { lat: 19.1900, lng: 73.1942 },
  'Hosur': { lat: 12.7409, lng: 77.8253 },
  'Sriperumbudur': { lat: 12.9675, lng: 79.9433 },
  'Vellakinar': { lat: 11.0168, lng: 76.9558 },
  'Jaipur': { lat: 26.9124, lng: 75.7873 },
  'Lucknow': { lat: 26.8467, lng: 80.9462 },
  'Noida': { lat: 28.5355, lng: 77.3910 },
  'Ghaziabad': { lat: 28.6692, lng: 77.4538 },
  'Kanpur': { lat: 26.4499, lng: 80.3319 },
  'Nagpur': { lat: 21.1458, lng: 79.0882 },
  'Indore': { lat: 22.7196, lng: 75.8577 },
  'Bhopal': { lat: 23.2599, lng: 77.4126 },
  'Patna': { lat: 25.5941, lng: 85.1376 },
  'Ranchi': { lat: 23.3441, lng: 85.3096 },
  'Bhubaneswar': { lat: 20.2961, lng: 85.8245 },
  'Raipur': { lat: 21.2514, lng: 81.6296 },
  'Thiruvananthapuram': { lat: 8.5241, lng: 76.9366 },
  'Kochi': { lat: 9.9312, lng: 76.2673 },
  'Visakhapatnam': { lat: 17.6869, lng: 83.2185 },
  'Vijayawada': { lat: 16.5062, lng: 80.6480 },
  'Coimbatore': { lat: 11.0168, lng: 76.9558 },
  'Madurai': { lat: 9.9252, lng: 78.1198 },
  'Surat': { lat: 21.1702, lng: 72.8311 },
  'Vadodara': { lat: 22.3072, lng: 73.1812 },
};

// Dynamically import MapContainer and related components (client-side only)
const MapContainer = dynamic(
  () => import('react-leaflet').then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((mod) => mod.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import('react-leaflet').then((mod) => mod.CircleMarker),
  { ssr: false }
);
const Popup = dynamic(
  () => import('react-leaflet').then((mod) => mod.Popup),
  { ssr: false }
);
const Tooltip = dynamic(
  () => import('react-leaflet').then((mod) => mod.Tooltip),
  { ssr: false }
);

export function IndiaMap({ stateData, className = '', showLegend = true }: IndiaMapProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Load Leaflet CSS only when component mounts
    import('leaflet/dist/leaflet.css');
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-lg ${className}`}>
        <div className="text-sm text-muted-foreground">Loading map...</div>
      </div>
    );
  }

  const maxCount = Math.max(...Object.values(stateData), 1);

  const getMarkerColor = (count: number) => {
    const intensity = count / maxCount;
    if (intensity > 0.7) return '#1e40af'; // blue-800
    if (intensity > 0.5) return '#2563eb'; // blue-600
    if (intensity > 0.3) return '#3b82f6'; // blue-500
    if (intensity > 0.1) return '#60a5fa'; // blue-400
    return '#93c5fd'; // blue-300
  };

  const getMarkerRadius = (count: number) => {
    const minRadius = 8;
    const maxRadius = 25;
    const intensity = count / maxCount;
    return minRadius + intensity * (maxRadius - minRadius);
  };

  // Center of India
  const centerIndia: [number, number] = [20.5937, 78.9629];

  return (
    <div className={`relative ${className}`}>
      <MapContainer
        center={centerIndia}
        zoom={5}
        style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
        scrollWheelZoom={false}
        className="z-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* City markers */}
        {Object.entries(stateData).map(([city, count]) => {
          const coords = CITY_COORDINATES[city];
          if (!coords || count === 0) return null;

          return (
            <CircleMarker
              key={city}
              center={[coords.lat, coords.lng]}
              radius={getMarkerRadius(count)}
              fillColor={getMarkerColor(count)}
              fillOpacity={0.7}
              color="#ffffff"
              weight={2}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold">{city}</div>
                  <div className="text-gray-600">{count} suppliers</div>
                </div>
              </Popup>
              <Tooltip direction="top" offset={[0, -10]} opacity={0.9}>
                <div className="text-xs">
                  <div className="font-semibold">{city}</div>
                  <div>{count} suppliers</div>
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend */}
      {showLegend && (
        <div className="absolute bottom-4 right-4 bg-white/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-xs z-10 border">
          <div className="font-medium mb-2 text-gray-700">Supplier Density</div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#1e40af' }} />
              <span className="text-gray-600">Very High (&gt;70%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#2563eb' }} />
              <span className="text-gray-600">High (50-70%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#3b82f6' }} />
              <span className="text-gray-600">Medium (30-50%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#60a5fa' }} />
              <span className="text-gray-600">Low (10-30%)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#93c5fd' }} />
              <span className="text-gray-600">Very Low (&lt;10%)</span>
            </div>
          </div>
          <div className="mt-2 pt-2 border-t text-gray-500 text-[10px]">
            Circle size indicates supplier count
          </div>
        </div>
      )}
    </div>
  );
}
