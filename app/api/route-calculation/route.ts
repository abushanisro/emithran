import { NextRequest, NextResponse } from 'next/server';

interface RouteRequest {
  fromAddress: string;
  toAddress: string;
  transportMode: string;
  optimizationLevel: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RouteRequest = await request.json();
    const { fromAddress, toAddress, transportMode, optimizationLevel } = body;

    if (!fromAddress || !toAddress) {
      return NextResponse.json(
        { error: 'Both fromAddress and toAddress are required' },
        { status: 400 }
      );
    }

    const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    console.log('API Key available:', !!googleApiKey);

    // Step 1: Geocode addresses
    let fromCoords: { lat: number; lng: number } | null = null;
    let toCoords: { lat: number; lng: number } | null = null;

    try {
      // Always try OpenStreetMap first (free and reliable)
      console.log('Geocoding with OpenStreetMap...');
      
      const osmFromResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(fromAddress)}&limit=1&countrycodes=in`,
        {
          headers: {
            'User-Agent': 'Mithran-Manufacturing-Platform/1.0 (contact@mithran.com)',
            'Accept': 'application/json'
          }
        }
      );
      const osmFromData = await osmFromResponse.json();
      if (osmFromData.length > 0) {
        fromCoords = { lat: parseFloat(osmFromData[0].lat), lng: parseFloat(osmFromData[0].lon) };
        console.log('From address geocoded:', fromCoords);
      }

      const osmToResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(toAddress)}&limit=1&countrycodes=in`,
        {
          headers: {
            'User-Agent': 'Mithran-Manufacturing-Platform/1.0 (contact@mithran.com)',
            'Accept': 'application/json'
          }
        }
      );
      const osmToData = await osmToResponse.json();
      if (osmToData.length > 0) {
        toCoords = { lat: parseFloat(osmToData[0].lat), lng: parseFloat(osmToData[0].lon) };
        console.log('To address geocoded:', toCoords);
      }

      // Try Google if OSM failed and API key is available
      if (googleApiKey && (!fromCoords || !toCoords)) {
        console.log('Trying Google Maps geocoding...');
        
        if (!fromCoords) {
          const fromGeocodeResponse = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fromAddress)}&key=${googleApiKey}`
          );
          const fromGeocodeData = await fromGeocodeResponse.json();

          if (fromGeocodeData.status === 'OK' && fromGeocodeData.results.length > 0) {
            const location = fromGeocodeData.results[0].geometry.location;
            fromCoords = { lat: location.lat, lng: location.lng };
            console.log('Google geocoded from address:', fromCoords);
          }
        }

        if (!toCoords) {
          const toGeocodeResponse = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(toAddress)}&key=${googleApiKey}`
          );
          const toGeocodeData = await toGeocodeResponse.json();

          if (toGeocodeData.status === 'OK' && toGeocodeData.results.length > 0) {
            const location = toGeocodeData.results[0].geometry.location;
            toCoords = { lat: location.lat, lng: location.lng };
            console.log('Google geocoded to address:', toCoords);
          }
        }
      }

      // Fallback to Indian city coordinates if geocoding failed
      if (!fromCoords || !toCoords) {
        console.log('Primary geocoding failed, trying fallback city coordinates...');
        
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
          'jaipur': { lat: 26.9124, lng: 75.7873 },
          'kochi': { lat: 9.9312, lng: 76.2673 },
          'gurgaon': { lat: 28.4595, lng: 77.0266 },
          'noida': { lat: 28.5355, lng: 77.3910 }
        };

        if (!fromCoords) {
          const fromAddressLower = fromAddress.toLowerCase();
          for (const [city, coords] of Object.entries(indianCities)) {
            if (fromAddressLower.includes(city)) {
              fromCoords = coords;
              console.log(`Using fallback coordinates for from address (${city}):`, fromCoords);
              break;
            }
          }
        }

        if (!toCoords) {
          const toAddressLower = toAddress.toLowerCase();
          for (const [city, coords] of Object.entries(indianCities)) {
            if (toAddressLower.includes(city)) {
              toCoords = coords;
              console.log(`Using fallback coordinates for to address (${city}):`, toCoords);
              break;
            }
          }
        }

        // Final check
        if (!fromCoords || !toCoords) {
          console.error('All geocoding methods failed:', { fromAddress, toAddress, fromCoords, toCoords });
          return NextResponse.json(
            { error: 'Could not geocode one or both addresses', details: { fromCoords, toCoords } },
            { status: 400 }
          );
        }
      }

    } catch (geocodeError) {
      console.error('Geocoding error:', geocodeError);
      return NextResponse.json(
        { error: 'Geocoding failed', details: geocodeError instanceof Error ? geocodeError.message : String(geocodeError) },
        { status: 500 }
      );
    }

    // Step 2: Calculate route
    let routeResult = null;

    try {
      // Try Google Directions first
      if (googleApiKey) {
        const travelMode = transportMode === 'bike' ? 'bicycling' : transportMode === 'walking' ? 'walking' : 'driving';
        const directionsResponse = await fetch(
          `https://maps.googleapis.com/maps/api/directions/json?origin=${fromCoords.lat},${fromCoords.lng}&destination=${toCoords.lat},${toCoords.lng}&mode=${travelMode}&departure_time=now&traffic_model=best_guess&key=${googleApiKey}`
        );

        if (directionsResponse.ok) {
          const directionsData = await directionsResponse.json();

          if (directionsData.status === 'OK' && directionsData.routes.length > 0) {
            const route = directionsData.routes[0];
            const leg = route.legs[0];

            routeResult = {
              distance: Math.round(leg.distance.value / 1000 * 100) / 100, // km
              duration: Math.round(leg.duration.value / 60), // minutes
              durationWithTraffic: leg.duration_in_traffic ? Math.round(leg.duration_in_traffic.value / 60) : undefined,
              optimizationScore: 85, // Google's routes are well optimized
              provider: 'google'
            };
          }
        }
      }

      // Fallback to OSRM
      if (!routeResult) {
        console.log('Trying OSRM routing...');
        const profile = transportMode === 'bike' ? 'bicycle' : transportMode === 'walking' ? 'foot' : 'driving';
        
        try {
          const osrmResponse = await fetch(
            `https://router.project-osrm.org/route/v1/${profile}/${fromCoords.lng},${fromCoords.lat};${toCoords.lng},${toCoords.lat}?overview=full&geometries=geojson&steps=false`,
            {
              headers: {
                'User-Agent': 'Mithran-Manufacturing-Platform/1.0'
              }
            }
          );

          if (osrmResponse.ok) {
            const osrmData = await osrmResponse.json();

            if (osrmData.routes && osrmData.routes.length > 0) {
              const route = osrmData.routes[0];
              console.log('OSRM routing successful');

              routeResult = {
                distance: Math.round(route.distance / 1000 * 100) / 100, // km
                duration: Math.round(route.duration / 60), // minutes
                optimizationScore: 75, // OSRM is good but not as optimized as Google
                provider: 'osrm'
              };
            } else {
              console.warn('OSRM returned no routes');
            }
          } else {
            console.warn(`OSRM request failed with status: ${osrmResponse.status}`);
          }
        } catch (osrmError) {
          console.warn('OSRM routing error:', osrmError);
        }
      }

      // Final fallback: Haversine calculation
      if (!routeResult) {
        const distance = calculateHaversineDistance(fromCoords, toCoords);
        const speeds = {
          car: 45,
          truck: 35,
          bike: 35,
          walking: 5
        };
        const speed = speeds[transportMode as keyof typeof speeds] || 45;
        const duration = Math.round((distance / speed) * 60);

        routeResult = {
          distance: Math.round(distance * 100) / 100,
          duration,
          optimizationScore: 50,
          provider: 'haversine',
          warnings: ['Using estimated calculation - actual route may vary']
        };
      }

    } catch (routeError) {
      console.error('Route calculation error:', routeError);
      return NextResponse.json(
        { error: 'Route calculation failed' },
        { status: 500 }
      );
    }

    // Step 3: Apply optimization adjustments and cost calculation
    if (optimizationLevel === 'fastest' && routeResult.durationWithTraffic) {
      routeResult.duration = routeResult.durationWithTraffic;
      routeResult.optimizationScore = (routeResult.optimizationScore || 70) + 10;
    } else if (optimizationLevel === 'shortest') {
      routeResult.duration = Math.round(routeResult.duration * 1.1);
      routeResult.optimizationScore = (routeResult.optimizationScore || 70) + 5;
    }

    // Calculate cost
    const costPerKm = {
      car: 8,
      truck: 12,
      bike: 4,
      walking: 2
    };
    const baseCost = routeResult.distance * (costPerKm[transportMode as keyof typeof costPerKm] || 8);
    const optimizationFactor = (routeResult.optimizationScore || 70) / 100;
    const cost = Math.round(baseCost * (2 - optimizationFactor) * 100) / 100;

    const finalResult = {
      ...routeResult,
      cost,
      fromCoords,
      toCoords
    };

    return NextResponse.json(finalResult);

  } catch (error) {
    console.error('Route calculation API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Haversine distance calculation
function calculateHaversineDistance(
  point1: { lat: number; lng: number },
  point2: { lat: number; lng: number }
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (point2.lat - point1.lat) * Math.PI / 180;
  const dLng = (point2.lng - point1.lng) * Math.PI / 180;
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(point1.lat * Math.PI / 180) * 
    Math.cos(point2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}