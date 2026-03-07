/**
 * Address Geocoding Service
 * Industry-standard geocoding using free OSM/Nominatim API
 */

interface Coordinates {
  lat: number;
  lng: number;
}

interface Address {
  addressLine1: string;
  city: string;
  state?: string;
  country: string;
  postalCode?: string;
}

class AddressGeocodingService {
  private readonly NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
  private readonly REQUEST_DELAY = 1000; // 1 second between requests (OSM rate limit)
  private lastRequestTime = 0;

  /**
   * Geocode address to coordinates
   * Respects OSM rate limits and usage policy
   */
  async geocodeAddress(address: Address): Promise<Coordinates | null> {
    try {
      // Respect rate limiting
      await this.enforceRateLimit();

      const addressString = this.formatAddressString(address);
      
      const response = await fetch(
        `${this.NOMINATIM_BASE}/search?format=json&q=${encodeURIComponent(addressString)}&limit=1&countrycodes=in`,
        {
          headers: {
            'User-Agent': 'DeliveryTrackingApp/1.0 (contact@company.com)', // Required by OSM
          },
        }
      );

      if (!response.ok) {
        console.error(`Geocoding failed: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
      }

      console.warn(`Address not found: ${addressString}`);
      return null;

    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  }

  /**
   * Batch geocode multiple addresses with proper rate limiting
   */
  async batchGeocodeAddresses(addresses: Address[]): Promise<(Coordinates | null)[]> {
    const results: (Coordinates | null)[] = [];

    for (const address of addresses) {
      const coords = await this.geocodeAddress(address);
      results.push(coords);
    }

    return results;
  }

  /**
   * Format address object into searchable string
   */
  private formatAddressString(address: Address): string {
    const parts = [
      address.addressLine1,
      address.city,
      address.state,
      address.postalCode,
      address.country
    ].filter(Boolean);

    return parts.join(', ');
  }

  /**
   * Enforce OSM rate limiting (1 request per second)
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
}

// Singleton instance
export const addressGeocodingService = new AddressGeocodingService();
export type { Coordinates, Address };