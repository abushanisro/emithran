import { NextRequest, NextResponse } from 'next/server';

interface RouteRequest {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
}

interface RouteResponse {
  distance: string;
  duration: number;
  coordinates: number[][];
  provider: string;
}

export async function POST(request: NextRequest) {
  try {
    const { from, to }: RouteRequest = await request.json();

    if (!from?.lat || !from?.lng || !to?.lat || !to?.lng) {
      return NextResponse.json(
        { error: 'Valid from and to coordinates are required' },
        { status: 400 }
      );
    }

    // Try multiple routing providers
    const providers = [
      {
        name: 'osrm',
        route: async () => {
          const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`;
          
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mithran-Manufacturing-Platform/1.0',
            },
          });

          if (!response.ok) {
            throw new Error(`OSRM HTTP ${response.status}`);
          }

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
          
          throw new Error('No OSRM routes found');
        }
      },
      {
        name: 'graphhopper',
        route: async () => {
          // GraphHopper free tier (requires API key for production)
          // For now, we'll skip this and rely on OSRM + fallback
          throw new Error('GraphHopper not configured');
        }
      }
    ];

    // Try each provider with timeout
    for (const provider of providers) {
      try {
        console.log(`Attempting routing with ${provider.name}`);
        
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Routing timeout')), 10000)
        );

        const result = await Promise.race([
          provider.route(),
          timeoutPromise
        ]);

        console.log(`Routing successful with ${provider.name}`);
        return NextResponse.json(result);

      } catch (error) {
        console.warn(`${provider.name} routing failed:`, error);
        continue;
      }
    }

    // Fallback to straight-line calculation
    const distance = calculateStraightLineDistance(from, to);
    const duration = Math.round(distance / 40 * 60); // Assume 40 km/h average

    console.log('Using straight-line fallback routing');
    return NextResponse.json({
      distance: distance.toFixed(1),
      duration,
      coordinates: [[from.lat, from.lng], [to.lat, to.lng]],
      provider: 'straight-line'
    });

  } catch (error) {
    console.error('Routing API error:', error);
    
    return NextResponse.json(
      { 
        error: 'Route calculation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

function calculateStraightLineDistance(
  from: { lat: number; lng: number }, 
  to: { lat: number; lng: number }
): number {
  const R = 6371; // Earth's radius in km
  const dLat = (to.lat - from.lat) * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(from.lat * Math.PI / 180) * 
    Math.cos(to.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}