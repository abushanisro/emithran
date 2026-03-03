import { NextRequest, NextResponse } from 'next/server';

interface GeocodeRequest {
  address: string;
}

interface GeocodeResponse {
  lat: number;
  lng: number;
  provider: string;
}

export async function POST(request: NextRequest) {
  try {
    const { address }: GeocodeRequest = await request.json();

    if (!address) {
      return NextResponse.json(
        { error: 'Address is required' },
        { status: 400 }
      );
    }

    // Try multiple geocoding providers with fallbacks
    const providers = [
      {
        name: 'nominatim',
        geocode: async (addr: string) => {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1&countrycodes=in`;
          
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mithran-Manufacturing-Platform/1.0 (contact@mithran.com)',
              'Accept': 'application/json',
            },
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          
          if (data && data.length > 0) {
            return {
              lat: parseFloat(data[0].lat),
              lng: parseFloat(data[0].lon),
              provider: 'nominatim'
            };
          }
          
          throw new Error('No results found');
        }
      }
    ];

    // Try each provider with timeout and retry logic
    for (const provider of providers) {
      try {
        console.log(`Attempting geocoding with ${provider.name} for: ${address}`);
        
        // Add timeout to prevent hanging requests
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Geocoding timeout')), 8000)
        );

        const result = await Promise.race([
          provider.geocode(address),
          timeoutPromise
        ]);

        console.log(`Geocoding successful with ${provider.name}:`, result);
        return NextResponse.json(result);

      } catch (error) {
        console.warn(`${provider.name} geocoding failed:`, error);
        continue;
      }
    }

    // Fallback to Indian city coordinates
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

    // Try to extract city from address
    const addressLower = address.toLowerCase();
    for (const [city, coords] of Object.entries(indianCities)) {
      if (addressLower.includes(city)) {
        console.log(`Using fallback coordinates for ${city}`);
        return NextResponse.json({
          ...coords,
          provider: 'fallback'
        });
      }
    }

    // Final fallback to Bengaluru
    console.log('Using default Bengaluru coordinates');
    return NextResponse.json({
      lat: 12.9716,
      lng: 77.5946,
      provider: 'default'
    });

  } catch (error) {
    console.error('Geocoding API error:', error);
    
    return NextResponse.json(
      { 
        error: 'Geocoding failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}