'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MapPin, Map, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface PlaceAddress {
  addressLine1: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
}

interface PlacesAutocompleteProps {
  value: string;
  onChange?: (value: string) => void;
  onPlaceSelected: (parts: PlaceAddress) => void;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
  id?: string;
}

declare global {
  interface Window {
    google: any;
  }
}

const MapLocationPicker = dynamic(() => import('./MapLocationPicker'), { ssr: false });

function getAddressComponent(components: any[], type: string): string {
  const found = components?.find((c: any) => c.types.includes(type));
  return found ? found.long_name : '';
}

function parseAddressComponents(
  components: any[],
  formattedAddress: string,
  lat: number,
  lng: number,
): PlaceAddress {
  const streetNumber = getAddressComponent(components, 'street_number');
  const route = getAddressComponent(components, 'route');
  const sublocality = getAddressComponent(components, 'sublocality_level_1');
  const addressLine1 =
    [streetNumber, route].filter(Boolean).join(' ') ||
    sublocality ||
    formattedAddress ||
    '';
  const city =
    getAddressComponent(components, 'locality') ||
    getAddressComponent(components, 'sublocality_level_1') ||
    getAddressComponent(components, 'administrative_area_level_2');
  const stateProvince = getAddressComponent(components, 'administrative_area_level_1');
  const postalCode = getAddressComponent(components, 'postal_code');
  const country = getAddressComponent(components, 'country');
  return { addressLine1, city, stateProvince, postalCode, country, latitude: lat, longitude: lng };
}

export default function PlacesAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder,
  className,
  hasError,
  id,
}: PlacesAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  // Ensure the Maps script is loaded (RouteMap may not be mounted yet)
  useEffect(() => {
    if (window.google?.maps?.Map) return; // already fully loaded
    if (document.querySelector('script[src*="maps.googleapis.com"]')) return; // already injected
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) return;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry`;
    script.async = true;
    script.onload = () => window.dispatchEvent(new Event('google-maps-loaded'));
    document.head.appendChild(script);
  }, []);

  // Initialise Google Places Autocomplete once the Maps script is loaded
  useEffect(() => {
    const init = () => {
      if (!inputRef.current || autocompleteRef.current) return;
      if (!window.google?.maps?.places) return;

      const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
        componentRestrictions: { country: 'in' },
        fields: ['address_components', 'geometry', 'formatted_address'],
        types: ['address'],
      });

      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (!place.address_components || !place.geometry) return;
        const parsed = parseAddressComponents(
          place.address_components,
          place.formatted_address ?? '',
          place.geometry.location.lat(),
          place.geometry.location.lng(),
        );
        onChange?.(parsed.addressLine1 || place.formatted_address || '');
        onPlaceSelected(parsed);
      });

      autocompleteRef.current = ac;
      setReady(true);
    };

    if (window.google?.maps?.places) { init(); return; }

    const t = setInterval(() => {
      if (window.google?.maps?.places) { clearInterval(t); init(); }
    }, 300);
    return () => clearInterval(t);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Use browser geolocation → reverse-geocode → fill fields
  const handleCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        if (!window.google?.maps) {
          setLocating(false);
          toast.error('Maps still loading — please try again in a few seconds');
          return;
        }
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode(
          { location: { lat: latitude, lng: longitude } },
          (results: any[], status: string) => {
            setLocating(false);
            if (status !== 'OK' || !results[0]) {
              toast.error('Could not determine your address from the GPS signal');
              return;
            }
            const place = results[0];
            const parsed = parseAddressComponents(
              place.address_components ?? [],
              place.formatted_address ?? '',
              latitude,
              longitude,
            );
            onChange?.(parsed.addressLine1 || place.formatted_address || '');
            onPlaceSelected(parsed);
            toast.success('Location detected', { description: place.formatted_address, duration: 3000 });
          },
        );
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          toast.error('Location permission denied', {
            description: 'Allow location access in your browser settings and try again.',
          });
        } else {
          toast.error('Could not get your location');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [onChange, onPlaceSelected]);

  return (
    <>
      <div className="relative">
        <Input
          ref={inputRef}
          id={id}
          defaultValue={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={ready ? (placeholder || 'Start typing an address…') : 'Loading maps…'}
          className={`pr-[4.5rem] ${className ?? ''} ${hasError ? 'border-red-300 focus:border-red-500' : ''}`}
          autoComplete="off"
        />

        {/* Icon buttons — right side */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          {/* Current location */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={handleCurrentLocation}
            disabled={locating}
            title="Use my current location"
          >
            {locating
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <MapPin className="h-3.5 w-3.5" />}
          </Button>

          {/* Map picker */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setMapOpen(true)}
            title="Pick location on map"
          >
            <Map className="h-3.5 w-3.5" />
          </Button>
        </div>


      </div>

      {/* Map picker dialog — rendered outside the relative wrapper to avoid z-index issues */}
      {mapOpen && (
        <MapLocationPicker
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          onConfirm={(place) => {
            onChange?.(place.addressLine1);
            onPlaceSelected(place);
            setMapOpen(false);
          }}
        />
      )}
    </>
  );
}
