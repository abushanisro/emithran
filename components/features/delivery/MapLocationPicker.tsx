'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin, Search, Crosshair } from 'lucide-react';
import { toast } from 'sonner';
import type { PlaceAddress } from './PlacesAutocomplete';

interface MapLocationPickerProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (place: PlaceAddress) => void;
  initialLocation?: { lat: number; lng: number };
}

const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

function getAddressComponent(components: any[], type: string): string {
  const found = components?.find((c: any) => c.types.includes(type));
  return found ? found.long_name : '';
}

export default function MapLocationPicker({
  open,
  onClose,
  onConfirm,
  initialLocation,
}: MapLocationPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const autocompleteRef = useRef<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [selectedPlace, setSelectedPlace] = useState<PlaceAddress | null>(null);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [locating, setLocating] = useState(false);

  const geocodeLatLng = useCallback((lat: number, lng: number) => {
    if (!window.google?.maps) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ location: { lat, lng } }, (results: any[], status: string) => {
      if (status !== 'OK' || !results[0]) return;
      const place = results[0];
      const comps = place.address_components || [];
      const streetNumber = getAddressComponent(comps, 'street_number');
      const route = getAddressComponent(comps, 'route');
      const sublocality = getAddressComponent(comps, 'sublocality_level_1');
      const addressLine1 =
        [streetNumber, route].filter(Boolean).join(' ') ||
        sublocality ||
        place.formatted_address ||
        '';
      const city =
        getAddressComponent(comps, 'locality') ||
        getAddressComponent(comps, 'sublocality_level_1') ||
        getAddressComponent(comps, 'administrative_area_level_2');
      const stateProvince = getAddressComponent(comps, 'administrative_area_level_1');
      const postalCode = getAddressComponent(comps, 'postal_code');
      const country = getAddressComponent(comps, 'country');

      setSelectedAddress(place.formatted_address || addressLine1);
      setSelectedPlace({ addressLine1, city, stateProvince, postalCode, country, latitude: lat, longitude: lng });
    });
  }, []);

  const placeMarker = useCallback(
    (lat: number, lng: number) => {
      if (!mapInstanceRef.current) return;
      if (markerRef.current) {
        markerRef.current.setPosition({ lat, lng });
      } else {
        markerRef.current = new window.google.maps.Marker({
          position: { lat, lng },
          map: mapInstanceRef.current,
          draggable: true,
          animation: window.google.maps.Animation.DROP,
        });
        markerRef.current.addListener('dragend', () => {
          const pos = markerRef.current.getPosition();
          geocodeLatLng(pos.lat(), pos.lng());
        });
      }
      mapInstanceRef.current.panTo({ lat, lng });
      mapInstanceRef.current.setZoom(16);
      geocodeLatLng(lat, lng);
    },
    [geocodeLatLng],
  );

  // Initialise Google Map once the dialog opens
  useEffect(() => {
    if (!open) return;

    const init = () => {
      if (!window.google?.maps?.Map) return;
      if (!mapRef.current) { setTimeout(init, 100); return; }
      if (mapInstanceRef.current) return;

      try {
        const map = new window.google.maps.Map(mapRef.current, {
          center: initialLocation ?? INDIA_CENTER,
          zoom: initialLocation ? 16 : 5,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControlOptions: { position: window.google.maps.ControlPosition.RIGHT_CENTER },
        });

        mapInstanceRef.current = map;
        map.addListener('click', (e: any) => placeMarker(e.latLng.lat(), e.latLng.lng()));

        if (searchRef.current && !autocompleteRef.current) {
          const ac = new window.google.maps.places.Autocomplete(searchRef.current, {
            componentRestrictions: { country: 'in' },
            fields: ['geometry', 'formatted_address', 'address_components'],
          });
          ac.addListener('place_changed', () => {
            const p = ac.getPlace();
            if (p.geometry?.location) {
              placeMarker(p.geometry.location.lat(), p.geometry.location.lng());
              if (searchRef.current) searchRef.current.value = p.formatted_address ?? '';
            }
          });
          autocompleteRef.current = ac;
        }

        if (initialLocation) placeMarker(initialLocation.lat, initialLocation.lng);
        setMapReady(true);
      } catch (err) {
        console.error('MapLocationPicker: failed to initialise Google Map', err);
      }
    };

    // Already loaded
    if (window.google?.maps?.Map) {
      setTimeout(init, 200);
      return;
    }

    // Inject the Maps script ourselves if nobody else has
    if (!document.querySelector('script[src*="maps.googleapis.com"]')) {
      const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (apiKey) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
        script.async = true;
        script.onload = () => window.dispatchEvent(new Event('google-maps-loaded'));
        document.head.appendChild(script);
      }
    }

    const onLoaded = () => setTimeout(init, 200);
    window.addEventListener('google-maps-loaded', onLoaded, { once: true });

    let t: ReturnType<typeof setInterval> | null = null;
    t = setInterval(() => {
      if (window.google?.maps?.Map) { clearInterval(t!); t = null; setTimeout(init, 200); }
    }, 300);

    return () => {
      window.removeEventListener('google-maps-loaded', onLoaded);
      if (t) clearInterval(t);
    };
  }, [open, initialLocation, placeMarker]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      mapInstanceRef.current = null;
      markerRef.current = null;
      autocompleteRef.current = null;
      setSelectedPlace(null);
      setSelectedAddress('');
      setMapReady(false);
    }
  }, [open]);

  const handleCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); placeMarker(pos.coords.latitude, pos.coords.longitude); },
      (err) => {
        setLocating(false);
        toast.error(err.code === err.PERMISSION_DENIED ? 'Location permission denied' : 'Could not get your location');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [placeMarker]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2">
          <DialogTitle className="text-base font-semibold">Pick Location on Map</DialogTitle>
        </DialogHeader>

        {/* Search bar */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search for an address or place…"
              className="w-full pl-9 pr-4 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
            />
          </div>
        </div>

        {/* Map container */}
        <div className="relative border-y">
          <div ref={mapRef} className="w-full h-[380px] bg-muted" />

          {/* My location FAB */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="absolute bottom-4 right-4 shadow-md gap-1.5 bg-background hover:bg-muted"
            onClick={handleCurrentLocation}
            disabled={locating || !mapReady}
          >
            <Crosshair className={`h-4 w-4 ${locating ? 'animate-spin' : ''}`} />
            {locating ? 'Locating…' : 'My location'}
          </Button>

          {/* Loading overlay */}
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/80 backdrop-blur-sm">
              <p className="text-sm text-muted-foreground animate-pulse">Loading map…</p>
            </div>
          )}

          {/* Hint pill */}
          {mapReady && !selectedPlace && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-background/90 backdrop-blur-sm text-xs px-3 py-1.5 rounded-full shadow border pointer-events-none whitespace-nowrap">
              Click anywhere on the map to drop a pin
            </div>
          )}
        </div>

        {/* Selected address preview */}
        {selectedAddress ? (
          <div className="px-4 py-3 bg-muted/30 flex items-start gap-2.5 min-h-[56px]">
            <MapPin className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-snug truncate">{selectedAddress}</p>
              {selectedPlace && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {[selectedPlace.city, selectedPlace.stateProvince, selectedPlace.postalCode]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 min-h-[56px] flex items-center">
            <p className="text-xs text-muted-foreground">No location selected yet</p>
          </div>
        )}

        <DialogFooter className="px-4 py-3 border-t">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedPlace}
            onClick={() => selectedPlace && onConfirm(selectedPlace)}
          >
            Use this location
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
