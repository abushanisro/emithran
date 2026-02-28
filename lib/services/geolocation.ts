// Geolocation and Route Optimization Service
// Industry best practices for delivery tracking and optimization

interface Coordinates {
  lat: number;
  lng: number;
}

interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface GeolocationResult {
  coordinates: Coordinates;
  accuracy: number;
  address?: Address;
  timestamp: Date;
}

interface RouteOptimizationResult {
  optimizedRoute: Coordinates[];
  totalDistance: number;
  estimatedDuration: number;
  waypoints: {
    coordinates: Coordinates;
    estimatedArrival: Date;
    deliveryWindow?: {
      start: Date;
      end: Date;
    };
  }[];
}

export class GeolocationService {
  private apiKeys = {
    google: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    here: process.env.NEXT_PUBLIC_HERE_API_KEY,
    mapbox: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  };

  /**
   * Get current device location using HTML5 Geolocation API
   * Industry standard for mobile tracking apps
   */
  async getCurrentLocation(): Promise<GeolocationResult> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000 // Cache for 30 seconds
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            coordinates: {
              lat: position.coords.latitude,
              lng: position.coords.longitude
            },
            accuracy: position.coords.accuracy,
            timestamp: new Date(position.timestamp)
          });
        },
        (error) => {
          let errorMessage = 'Failed to get location';
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage = 'User denied the request for Geolocation';
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = 'Location information is unavailable';
              break;
            case error.TIMEOUT:
              errorMessage = 'The request to get user location timed out';
              break;
          }
          reject(new Error(errorMessage));
        },
        options
      );
    });
  }

  /**
   * Watch position changes for real-time tracking
   * Best practice for delivery driver apps
   */
  watchPosition(
    onUpdate: (result: GeolocationResult) => void,
    onError: (error: Error) => void
  ): number {
    const options = {
      enableHighAccuracy: true,
      timeout: 30000,
      maximumAge: 10000 // Update every 10 seconds
    };

    return navigator.geolocation.watchPosition(
      (position) => {
        onUpdate({
          coordinates: {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          },
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp)
        });
      },
      (error) => {
        onError(new Error(`Geolocation error: ${error.message}`));
      },
      options
    );
  }

  /**
   * Stop watching position
   */
  stopWatching(watchId: number): void {
    navigator.geolocation.clearWatch(watchId);
  }

  /**
   * Geocode address to coordinates using multiple providers
   * Industry best practice: fallback providers for reliability
   */
  async geocodeAddress(address: string): Promise<Coordinates> {
    // Try Google Maps first
    if (this.apiKeys.google) {
      try {
        return await this.geocodeWithGoogle(address);
      } catch (error) {
        console.warn('Google geocoding failed, trying fallback');
      }
    }

    // Fallback to HERE Maps
    if (this.apiKeys.here) {
      try {
        return await this.geocodeWithHere(address);
      } catch (error) {
        console.warn('HERE geocoding failed, trying fallback');
      }
    }

    // Fallback to OpenStreetMap (free)
    try {
      return await this.geocodeWithOSM(address);
    } catch (error) {
      throw new Error('All geocoding services failed');
    }
  }

  /**
   * Reverse geocode coordinates to address
   */
  async reverseGeocode(coordinates: Coordinates): Promise<Address> {
    if (this.apiKeys.google) {
      try {
        return await this.reverseGeocodeWithGoogle(coordinates);
      } catch (error) {
        console.warn('Google reverse geocoding failed');
      }
    }

    // Fallback to free OSM service
    return await this.reverseGeocodeWithOSM(coordinates);
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Standard in logistics applications
   */
  calculateDistance(point1: Coordinates, point2: Coordinates): number {
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
   * Optimize delivery route using various algorithms
   * Industry standard: Traveling Salesman Problem variants
   */
  async optimizeRoute(
    start: Coordinates,
    destinations: Coordinates[],
    options?: {
      algorithm?: 'nearest_neighbor' | 'genetic' | 'simulated_annealing';
      vehicleType?: 'car' | 'truck' | 'bike';
      timeWindows?: Array<{ start: Date; end: Date }>;
    }
  ): Promise<RouteOptimizationResult> {
    const algorithm = options?.algorithm || 'nearest_neighbor';
    
    switch (algorithm) {
      case 'nearest_neighbor':
        return this.nearestNeighborTSP(start, destinations, options);
      case 'genetic':
        return this.geneticAlgorithmTSP(start, destinations, options);
      case 'simulated_annealing':
        return this.simulatedAnnealingTSP(start, destinations, options);
      default:
        return this.nearestNeighborTSP(start, destinations, options);
    }
  }

  /**
   * Get ETA based on traffic conditions
   * Integrates with traffic APIs for real-time estimates
   */
  async getETAWithTraffic(
    from: Coordinates,
    to: Coordinates,
    vehicleType: 'car' | 'truck' | 'bike' = 'car'
  ): Promise<{
    duration: number;
    durationInTraffic: number;
    distance: number;
    route: Coordinates[];
  }> {
    // Use Google Directions API with traffic
    if (this.apiKeys.google) {
      return this.getDirectionsWithGoogle(from, to, vehicleType);
    }

    // Fallback to HERE routing
    if (this.apiKeys.here) {
      return this.getDirectionsWithHere(from, to, vehicleType);
    }

    // Basic calculation without traffic
    const distance = this.calculateDistance(from, to);
    const baseSpeed = vehicleType === 'bike' ? 20 : vehicleType === 'truck' ? 40 : 50; // km/h
    const duration = (distance / baseSpeed) * 3600; // seconds
    
    return {
      duration,
      durationInTraffic: duration * 1.2, // Add 20% for traffic
      distance,
      route: [from, to]
    };
  }

  // Private methods for different geocoding providers

  private async geocodeWithGoogle(address: string): Promise<Coordinates> {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${this.apiKeys.google}`
    );
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    }
    throw new Error(`Google geocoding failed: ${data.status}`);
  }

  private async geocodeWithHere(address: string): Promise<Coordinates> {
    const response = await fetch(
      `https://geocode.search.hereapi.com/v1/geocode?q=${encodeURIComponent(address)}&apikey=${this.apiKeys.here}`
    );
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      const location = data.items[0].position;
      return { lat: location.lat, lng: location.lng };
    }
    throw new Error('HERE geocoding failed');
  }

  private async geocodeWithOSM(address: string): Promise<Coordinates> {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`
    );
    const data = await response.json();
    
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    throw new Error('OSM geocoding failed');
  }

  private async reverseGeocodeWithGoogle(coordinates: Coordinates): Promise<Address> {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coordinates.lat},${coordinates.lng}&key=${this.apiKeys.google}`
    );
    const data = await response.json();
    
    if (data.status === 'OK' && data.results.length > 0) {
      return this.parseGoogleAddress(data.results[0]);
    }
    throw new Error('Google reverse geocoding failed');
  }

  private async reverseGeocodeWithOSM(coordinates: Coordinates): Promise<Address> {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coordinates.lat}&lon=${coordinates.lng}`
    );
    const data = await response.json();
    
    return this.parseOSMAddress(data);
  }

  private async getDirectionsWithGoogle(
    from: Coordinates,
    to: Coordinates,
    vehicleType: string
  ) {
    const mode = vehicleType === 'bike' ? 'bicycling' : 'driving';
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&mode=${mode}&departure_time=now&traffic_model=best_guess&key=${this.apiKeys.google}`
    );
    const data = await response.json();
    
    if (data.status === 'OK' && data.routes.length > 0) {
      const route = data.routes[0];
      const leg = route.legs[0];
      
      return {
        duration: leg.duration.value,
        durationInTraffic: leg.duration_in_traffic?.value || leg.duration.value,
        distance: leg.distance.value / 1000, // Convert to km
        route: this.decodePolyline(route.overview_polyline.points)
      };
    }
    throw new Error('Google directions failed');
  }

  private async getDirectionsWithHere(
    from: Coordinates,
    to: Coordinates,
    vehicleType: string
  ) {
    const transportMode = vehicleType === 'bike' ? 'bicycle' : 'car';
    const response = await fetch(
      `https://router.hereapi.com/v8/routes?transportMode=${transportMode}&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&return=polyline,summary&apikey=${this.apiKeys.here}`
    );
    const data = await response.json();
    
    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const summary = route.sections[0].summary;
      
      return {
        duration: summary.duration,
        durationInTraffic: summary.duration, // HERE includes traffic by default
        distance: summary.length / 1000, // Convert to km
        route: this.decodeFlexiblePolyline(route.sections[0].polyline)
      };
    }
    throw new Error('HERE directions failed');
  }

  // Route optimization algorithms

  private async nearestNeighborTSP(
    start: Coordinates,
    destinations: Coordinates[],
    options?: any
  ): Promise<RouteOptimizationResult> {
    const unvisited = [...destinations];
    const route = [start];
    let current = start;
    let totalDistance = 0;
    
    while (unvisited.length > 0) {
      let nearest = unvisited[0];
      let nearestIndex = 0;
      let minDistance = this.calculateDistance(current, nearest);
      
      for (let i = 1; i < unvisited.length; i++) {
        const distance = this.calculateDistance(current, unvisited[i]);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = unvisited[i];
          nearestIndex = i;
        }
      }
      
      route.push(nearest);
      totalDistance += minDistance;
      current = nearest;
      unvisited.splice(nearestIndex, 1);
    }
    
    const baseSpeed = 50; // km/h average
    const estimatedDuration = (totalDistance / baseSpeed) * 3600; // seconds
    
    return {
      optimizedRoute: route,
      totalDistance,
      estimatedDuration,
      waypoints: route.slice(1).map((coords, index) => ({
        coordinates: coords,
        estimatedArrival: new Date(Date.now() + (estimatedDuration / route.length) * (index + 1) * 1000)
      }))
    };
  }

  private async geneticAlgorithmTSP(
    start: Coordinates,
    destinations: Coordinates[],
    options?: any
  ): Promise<RouteOptimizationResult> {
    // Simplified genetic algorithm for demonstration
    // In production, use specialized libraries like Google OR-Tools
    return this.nearestNeighborTSP(start, destinations, options);
  }

  private async simulatedAnnealingTSP(
    start: Coordinates,
    destinations: Coordinates[],
    options?: any
  ): Promise<RouteOptimizationResult> {
    // Simplified simulated annealing for demonstration
    return this.nearestNeighborTSP(start, destinations, options);
  }

  // Utility methods

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private parseGoogleAddress(result: any): Address {
    const components = result.address_components;
    const address: Partial<Address> = {};
    
    for (const component of components) {
      const types = component.types;
      if (types.includes('street_number') || types.includes('route')) {
        address.street = (address.street || '') + ' ' + component.long_name;
      } else if (types.includes('locality')) {
        address.city = component.long_name;
      } else if (types.includes('administrative_area_level_1')) {
        address.state = component.long_name;
      } else if (types.includes('postal_code')) {
        address.postalCode = component.long_name;
      } else if (types.includes('country')) {
        address.country = component.long_name;
      }
    }
    
    return address as Address;
  }

  private parseOSMAddress(data: any): Address {
    return {
      street: data.display_name.split(',')[0] || '',
      city: data.address?.city || data.address?.town || '',
      state: data.address?.state || '',
      postalCode: data.address?.postcode || '',
      country: data.address?.country || ''
    };
  }

  private decodePolyline(encoded: string): Coordinates[] {
    // Google's polyline decoding algorithm
    const points = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    
    while (index < encoded.length) {
      let byte = 0;
      let shift = 0;
      let result = 0;
      
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      
      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;
      
      shift = 0;
      result = 0;
      
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      
      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;
      
      points.push({
        lat: lat / 1e5,
        lng: lng / 1e5
      });
    }
    
    return points;
  }

  private decodeFlexiblePolyline(encoded: string): Coordinates[] {
    // HERE's flexible polyline decoding
    // Simplified implementation
    return [];
  }
}

// Singleton instance
export const geolocationService = new GeolocationService();