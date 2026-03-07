/**
 * Route Optimization Service
 * Production-ready routing using OpenRouteService (free tier)
 */

interface Coordinates {
  lat: number;
  lng: number;
}

interface RouteResult {
  distance: number; // in meters
  duration: number; // in seconds
  geometry: Coordinates[];
  instructions?: RouteInstruction[];
}

interface RouteInstruction {
  instruction: string;
  distance: number;
  duration: number;
  wayIndex: number;
}

interface OptimizedRoute {
  waypoints: Coordinates[];
  totalDistance: number;
  totalDuration: number;
  routes: RouteResult[];
}

class RouteOptimizationService {
  private readonly ORS_BASE = 'https://api.openrouteservice.org/v2';
  private readonly OSRM_BASE = 'https://router.project-osrm.org'; // Free fallback
  private readonly REQUEST_DELAY = 1000; // 1 second between requests
  private lastRequestTime = 0;

  /**
   * Calculate route between two points
   */
  async calculateRoute(
    start: Coordinates, 
    end: Coordinates,
    profile: 'driving-car' | 'driving-hgv' | 'cycling-regular' = 'driving-car'
  ): Promise<RouteResult> {
    try {
      await this.enforceRateLimit();

      // Try OpenRouteService first (if API key available)
      const apiKey = process.env.NEXT_PUBLIC_OPENROUTE_API_KEY;
      if (apiKey) {
        return await this.calculateRouteWithORS(start, end, profile, apiKey);
      }

      // Fallback to OSRM (free, no API key required)
      return await this.calculateRouteWithOSRM(start, end);

    } catch (error) {
      console.error('Route calculation failed:', error);
      // No fallbacks - accurate data only
      this.handleRouteFailed(start, end);
    }
  }

  /**
   * Optimize route for multiple waypoints using TSP algorithms
   */
  async optimizeMultipleWaypoints(
    start: Coordinates,
    waypoints: Coordinates[],
    returnToStart: boolean = false
  ): Promise<OptimizedRoute> {
    if (waypoints.length === 0) {
      return {
        waypoints: [start],
        totalDistance: 0,
        totalDuration: 0,
        routes: []
      };
    }

    if (waypoints.length === 1) {
      const route = await this.calculateRoute(start, waypoints[0]);
      return {
        waypoints: returnToStart ? [start, waypoints[0], start] : [start, waypoints[0]],
        totalDistance: returnToStart ? route.distance * 2 : route.distance,
        totalDuration: returnToStart ? route.duration * 2 : route.duration,
        routes: returnToStart ? [route, await this.calculateRoute(waypoints[0], start)] : [route]
      };
    }

    // Use nearest neighbor algorithm for multiple waypoints
    return await this.nearestNeighborTSP(start, waypoints, returnToStart);
  }

  /**
   * Get ETA with traffic consideration
   */
  async getETAWithTraffic(
    start: Coordinates,
    end: Coordinates,
    departureTime?: Date
  ): Promise<{
    normalDuration: number;
    trafficDuration: number;
    distance: number;
    route: Coordinates[];
  }> {
    const route = await this.calculateRoute(start, end);
    
    // Apply traffic multiplier based on time of day
    const hour = (departureTime || new Date()).getHours();
    let trafficMultiplier = 1.0;

    // Rush hour traffic estimation
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      trafficMultiplier = 1.5; // 50% longer during rush hour
    } else if (hour >= 22 || hour <= 5) {
      trafficMultiplier = 0.8; // 20% faster during night hours
    }

    return {
      normalDuration: route.duration,
      trafficDuration: Math.round(route.duration * trafficMultiplier),
      distance: route.distance,
      route: route.geometry
    };
  }

  /**
   * Calculate route using OpenRouteService (premium features)
   */
  private async calculateRouteWithORS(
    start: Coordinates,
    end: Coordinates,
    profile: string,
    apiKey: string
  ): Promise<RouteResult> {
    const response = await fetch(
      `${this.ORS_BASE}/directions/${profile}/geojson`,
      {
        method: 'POST',
        headers: {
          'Authorization': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [[start.lng, start.lat], [end.lng, end.lat]],
          format: 'geojson',
          instructions: true,
          geometry: true
        })
      }
    );

    if (!response.ok) {
      throw new Error(`ORS API error: ${response.status}`);
    }

    const data = await response.json();
    const route = data.features[0];
    const properties = route.properties;

    return {
      distance: properties.segments[0].distance,
      duration: properties.segments[0].duration,
      geometry: route.geometry.coordinates.map((coord: number[]) => ({
        lat: coord[1],
        lng: coord[0]
      })),
      instructions: properties.segments[0].steps?.map((step: any) => ({
        instruction: step.instruction,
        distance: step.distance,
        duration: step.duration,
        wayIndex: step.way_points[0]
      }))
    };
  }

  /**
   * Calculate route using OSRM (free fallback)
   */
  private async calculateRouteWithOSRM(
    start: Coordinates,
    end: Coordinates
  ): Promise<RouteResult> {
    const response = await fetch(
      `${this.OSRM_BASE}/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`
    );

    if (!response.ok) {
      throw new Error(`OSRM API error: ${response.status}`);
    }

    const data = await response.json();
    const route = data.routes[0];

    return {
      distance: route.distance,
      duration: route.duration,
      geometry: route.geometry.coordinates.map((coord: number[]) => ({
        lat: coord[1],
        lng: coord[0]
      }))
    };
  }

  /**
   * Handle route calculation failure - no fallbacks for accurate data
   */
  private handleRouteFailed(start: Coordinates, end: Coordinates): never {
    throw new Error(`Route calculation failed between ${start.lat},${start.lng} and ${end.lat},${end.lng} - no fallback used for accurate data`);
  }

  /**
   * Nearest Neighbor TSP algorithm for route optimization
   */
  private async nearestNeighborTSP(
    start: Coordinates,
    waypoints: Coordinates[],
    returnToStart: boolean
  ): Promise<OptimizedRoute> {
    const unvisited = [...waypoints];
    const orderedWaypoints = [start];
    const routes: RouteResult[] = [];
    let current = start;
    let totalDistance = 0;
    let totalDuration = 0;

    // Visit each waypoint using nearest neighbor
    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;
      let nearestRoute: RouteResult | null = null;

      // Find nearest unvisited waypoint
      for (let i = 0; i < unvisited.length; i++) {
        const distance = this.calculateHaversineDistance(current, unvisited[i]);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }

      // Calculate actual route to nearest waypoint
      const nearest = unvisited[nearestIndex];
      nearestRoute = await this.calculateRoute(current, nearest);
      
      orderedWaypoints.push(nearest);
      routes.push(nearestRoute);
      totalDistance += nearestRoute.distance;
      totalDuration += nearestRoute.duration;
      
      current = nearest;
      unvisited.splice(nearestIndex, 1);
    }

    // Return to start if required
    if (returnToStart) {
      const returnRoute = await this.calculateRoute(current, start);
      orderedWaypoints.push(start);
      routes.push(returnRoute);
      totalDistance += returnRoute.distance;
      totalDuration += returnRoute.duration;
    }

    return {
      waypoints: orderedWaypoints,
      totalDistance,
      totalDuration,
      routes
    };
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateHaversineDistance(point1: Coordinates, point2: Coordinates): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(point2.lat - point1.lat);
    const dLng = this.toRadians(point2.lng - point1.lng);
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(point1.lat)) * 
      Math.cos(this.toRadians(point2.lat)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  }

  /**
   * Enforce rate limiting to respect API limits
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.REQUEST_DELAY) {
      const waitTime = this.REQUEST_DELAY - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}

// Singleton instance
export const routeOptimizationService = new RouteOptimizationService();
export type { Coordinates, RouteResult, OptimizedRoute, RouteInstruction };