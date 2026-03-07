import { NextRequest, NextResponse } from 'next/server';

interface RouteRequest {
  fromAddress: string;
  toAddress: string;
  transportMode: string;
  optimizationLevel: string;
  materialType?: string;
}

// ─── Industry-standard cost rates (INR per km) ────────────────────────────────
const TRANSPORT_RATES: Record<string, {
  baseCostPerKm: number;  // INR/km base
  loadingCost: number;    // INR flat per shipment (loading + unloading)
  avgSpeedKmh: number;
  label: string;
}> = {
  car: { baseCostPerKm: 14, loadingCost: 200, avgSpeedKmh: 45, label: 'Car/Light Vehicle' },
  truck: { baseCostPerKm: 22, loadingCost: 800, avgSpeedKmh: 35, label: 'Truck/Heavy Vehicle' },
  bike: { baseCostPerKm: 7, loadingCost: 100, avgSpeedKmh: 35, label: 'Motorcycle' },
  walking: { baseCostPerKm: 3, loadingCost: 50, avgSpeedKmh: 5, label: 'Walking/Handcart' },
  ship: { baseCostPerKm: 2.5, loadingCost: 5000, avgSpeedKmh: 25, label: 'Ship/Maritime' },
  flight: { baseCostPerKm: 55, loadingCost: 3000, avgSpeedKmh: 800, label: 'Air Cargo' },
};

// ─── Material type cost multipliers ───────────────────────────────────────────
const MATERIAL_MULTIPLIERS: Record<string, { label: string; multiplier: number }> = {
  general: { label: 'General Goods', multiplier: 1.00 },
  wooden_box: { label: 'Wooden Box / Crate', multiplier: 1.10 },
  metal_box: { label: 'Metal Box / Container', multiplier: 1.20 },
  fragile: { label: 'Fragile Items', multiplier: 1.50 },
  hazardous: { label: 'Hazardous Materials', multiplier: 2.20 },
  perishable: { label: 'Perishable Goods', multiplier: 1.35 },
  bulk: { label: 'Bulk Materials', multiplier: 0.85 },
  electronics: { label: 'Electronics', multiplier: 1.45 },
  pharmaceuticals: { label: 'Pharmaceuticals', multiplier: 1.90 },
};

// ─── Optimization adjustments ─────────────────────────────────────────────────
const OPTIMIZATION_ADJUSTMENTS: Record<string, { costFactor: number; speedFactor: number }> = {
  fastest: { costFactor: 1.15, speedFactor: 1.10 }, // pay more, go faster
  balanced: { costFactor: 1.00, speedFactor: 1.00 }, // baseline
  shortest: { costFactor: 0.92, speedFactor: 0.90 }, // save cost, longer time
};

export async function POST(request: NextRequest) {
  try {
    const body: RouteRequest = await request.json();
    const { fromAddress, toAddress, transportMode, optimizationLevel, materialType } = body;

    if (!fromAddress || !toAddress) {
      return NextResponse.json(
        { error: 'Both fromAddress and toAddress are required' },
        { status: 400 }
      );
    }

    const googleApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    const transportConfig = (TRANSPORT_RATES[transportMode] ?? TRANSPORT_RATES.car)!;
    const materialConfig = (materialType ? MATERIAL_MULTIPLIERS[materialType] : null) ?? MATERIAL_MULTIPLIERS.general;
    const optimizationConfig = (OPTIMIZATION_ADJUSTMENTS[optimizationLevel] ?? OPTIMIZATION_ADJUSTMENTS.balanced)!;

    // ── Step 1: Geocode both addresses ──────────────────────────────────────
    let fromCoords: { lat: number; lng: number } | null = null;
    let toCoords: { lat: number; lng: number } | null = null;

    try {
      // Clean up addresses for better geocoding
      const cleanAddress = (addr: string) => {
        return addr
          .replace(/\s+/g, ' ')  // Replace multiple spaces with single space
          .replace(/,\s*,/g, ',') // Remove double commas
          .trim();
      };

      const cleanFromAddress = cleanAddress(fromAddress);
      const cleanToAddress = cleanAddress(toAddress);

      // OSM Nominatim (free, primary for India)
      const [osmFrom, osmTo] = await Promise.all([
        fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanFromAddress)}&limit=1&countrycodes=in`,
          { headers: { 'User-Agent': 'Mithran-Manufacturing-Platform/1.0', 'Accept': 'application/json' } }
        ).then(r => r.json()),
        fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanToAddress)}&limit=1&countrycodes=in`,
          { headers: { 'User-Agent': 'Mithran-Manufacturing-Platform/1.0', 'Accept': 'application/json' } }
        ).then(r => r.json()),
      ]);

      if (osmFrom.length > 0) fromCoords = { lat: parseFloat(osmFrom[0].lat), lng: parseFloat(osmFrom[0].lon) };
      if (osmTo.length > 0) toCoords = { lat: parseFloat(osmTo[0].lat), lng: parseFloat(osmTo[0].lon) };

      // Google fallback if key is available
      if (googleApiKey && (!fromCoords || !toCoords)) {
        if (!fromCoords) {
          const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cleanFromAddress)}&key=${googleApiKey}`);
          const data = await res.json();
          if (data.status === 'OK') fromCoords = data.results[0].geometry.location;
        }
        if (!toCoords) {
          const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(cleanToAddress)}&key=${googleApiKey}`);
          const data = await res.json();
          if (data.status === 'OK') toCoords = data.results[0].geometry.location;
        }
      }

      // Indian city coordinate fallback
      if (!fromCoords || !toCoords) {
        const indianCities: Record<string, { lat: number; lng: number }> = {
          'bangalore': { lat: 12.9716, lng: 77.5946 }, 'bengaluru': { lat: 12.9716, lng: 77.5946 },
          'mumbai': { lat: 19.0760, lng: 72.8777 }, 'delhi': { lat: 28.7041, lng: 77.1025 },
          'chennai': { lat: 13.0827, lng: 80.2707 }, 'kolkata': { lat: 22.5726, lng: 88.3639 },
          'hyderabad': { lat: 17.3850, lng: 78.4867 }, 'pune': { lat: 18.5204, lng: 73.8567 },
          'ahmedabad': { lat: 23.0225, lng: 72.5714 }, 'jaipur': { lat: 26.9124, lng: 75.7873 },
          'kochi': { lat: 9.9312, lng: 76.2673 }, 'surat': { lat: 21.1702, lng: 72.8311 },
          'lucknow': { lat: 26.8467, lng: 80.9462 }, 'nagpur': { lat: 21.1458, lng: 79.0882 },
          'vizag': { lat: 17.6868, lng: 83.2185 }, 'visakhapatnam': { lat: 17.6868, lng: 83.2185 },
          'coimbatore': { lat: 11.0168, lng: 76.9558 }, 'bhopal': { lat: 23.2599, lng: 77.4126 },
          'nagercoil': { lat: 8.1774, lng: 77.4349 }, 'kanyakumari': { lat: 8.0883, lng: 77.5385 },
        };
        const tryCity = (addr: string) => {
          const lower = addr.toLowerCase();
          // Try exact city name matches first
          for (const [city, coords] of Object.entries(indianCities)) {
            if (lower.includes(city)) return coords;
          }
          return null;
        };
        if (!fromCoords) fromCoords = tryCity(cleanFromAddress);
        if (!toCoords) toCoords = tryCity(cleanToAddress);
      }

      if (!fromCoords || !toCoords) {
        return NextResponse.json(
          { error: 'Could not geocode one or both addresses. Please use Indian addresses.' },
          { status: 400 }
        );
      }
    } catch (err) {
      return NextResponse.json({ error: 'Geocoding failed' }, { status: 500 });
    }

    // ── Step 2: Get real road distance and duration ──────────────────────────
    let distanceKm = 0;
    let durationMin = 0;
    let routeProvider = 'haversine';
    let routingQuality: 'real' | 'estimated' = 'estimated';

    const isSpecialMode = transportMode === 'ship' || transportMode === 'flight';

    if (!isSpecialMode) {
      // Try OSRM for road routing
      try {
        const osrmProfile = transportMode === 'bike' ? 'bicycle' : transportMode === 'walking' ? 'foot' : 'driving';
        const osrmRes = await fetch(
          `https://router.project-osrm.org/route/v1/${osrmProfile}/${fromCoords.lng},${fromCoords.lat};${toCoords.lng},${toCoords.lat}?overview=false`,
          { headers: { 'User-Agent': 'Mithran-Manufacturing-Platform/1.0' }, signal: AbortSignal.timeout(8000) }
        );
        if (osrmRes.ok) {
          const osrmData = await osrmRes.json();
          if (osrmData.routes?.length > 0) {
            distanceKm = Math.round(osrmData.routes[0].distance / 1000 * 10) / 10;
            durationMin = Math.round(osrmData.routes[0].duration / 60);
            routeProvider = 'osrm';
            routingQuality = 'real';
          }
        }
      } catch { }

      // Google fallback
      if (routingQuality !== 'real' && googleApiKey) {
        try {
          const travelMode = transportMode === 'bike' ? 'bicycling' : transportMode === 'walking' ? 'walking' : 'driving';
          const gRes = await fetch(
            `https://maps.googleapis.com/maps/api/directions/json?origin=${fromCoords.lat},${fromCoords.lng}&destination=${toCoords.lat},${toCoords.lng}&mode=${travelMode}&key=${googleApiKey}`
          );
          if (gRes.ok) {
            const gData = await gRes.json();
            if (gData.status === 'OK') {
              const leg = gData.routes[0].legs[0];
              distanceKm = Math.round(leg.distance.value / 1000 * 10) / 10;
              durationMin = Math.round(leg.duration.value / 60);
              routeProvider = 'google';
              routingQuality = 'real';
            }
          }
        } catch { }
      }
    }

    // Haversine fallback for all modes (or ship/flight)
    if (routingQuality !== 'real' || isSpecialMode) {
      const R = 6371;
      const dLat = (toCoords.lat - fromCoords.lat) * Math.PI / 180;
      const dLng = (toCoords.lng - fromCoords.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(fromCoords.lat * Math.PI / 180) * Math.cos(toCoords.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      const straightLine = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // Road factor: actual road distance is ~1.2–1.4× straight-line for India
      const roadFactor = isSpecialMode ? 1.0 : 1.3;
      distanceKm = Math.round(straightLine * roadFactor * 10) / 10;
      durationMin = Math.round((distanceKm / transportConfig.avgSpeedKmh) * 60);
      routeProvider = isSpecialMode ? (transportMode === 'ship' ? 'maritime-haversine' : 'aviation-haversine') : 'estimated';
      routingQuality = 'estimated';
    }

    // Apply optimization speed factor
    durationMin = Math.round(durationMin / optimizationConfig.speedFactor);

    // ── Step 3: Accurate cost calculation ───────────────────────────────────
    // Base transport cost = per km rate × distance + loading/unloading
    const transportCost = (transportConfig.baseCostPerKm * distanceKm) + transportConfig.loadingCost;

    // Material handling multiplier
    const materialMultiplier = materialConfig?.multiplier ?? 1.0;

    // Optimization factor (fastest = +15% cost, shortest = -8% cost)
    const totalCost = Math.round(transportCost * materialMultiplier * optimizationConfig.costFactor);

    // Fuel/toll surcharge (5–8% on road, not applicable for ship/flight)
    const surcharge = isSpecialMode ? 0 : Math.round(totalCost * 0.06);

    const finalCost = totalCost + surcharge;

    // ── Step 4: Data quality score for route accuracy ──
    const dataQualityScore = routingQuality === 'real'
      ? (routeProvider === 'google' ? 96 : 91)
      : 72;

    return NextResponse.json({
      distance: distanceKm,
      duration: durationMin,
      cost: finalCost,
      costBreakdown: {
        transportBase: Math.round(transportConfig.baseCostPerKm * distanceKm),
        loadingUnloading: transportConfig.loadingCost,
        materialSurcharge: Math.round((materialMultiplier - 1) * transportCost),
        fuelTollSurcharge: surcharge,
        total: finalCost,
      },
      dataQualityScore,
      routeProvider,
      isEstimated: routingQuality === 'estimated',
      fromCoords,
      toCoords,
      transportMode,
      materialType: materialType || 'general',
      optimizationLevel,
    });

  } catch (error) {
    console.error('Route calculation API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}