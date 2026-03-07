/**
 * Delivery Tracking API
 * 
 * Production-ready real-time tracking system integrated with Supabase
 */

import { supabaseAdmin } from '@/lib/database/supabase-server';
import { carrierTrackingService } from '@/lib/services/carrier-tracking';
import type { DeliveryOrder, TrackingEvent } from './hooks/useDelivery';

export interface TrackingData {
  orderId: string;
  orderNumber: string;
  status: 'pending' | 'pickup' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed';
  priority: 'low' | 'standard' | 'high' | 'urgent';
  estimatedDelivery: string;
  actualDelivery?: string;
  customer: {
    name: string;
    phone: string;
    address: string;
  };
  origin: {
    lat: number;
    lng: number;
    address: string;
  };
  destination: {
    lat: number;
    lng: number;
    address: string;
  };
  currentLocation?: {
    lat: number;
    lng: number;
    timestamp: string;
  };
  carrier: {
    name: string;
    trackingNumber: string;
    driverName?: string;
    driverPhone?: string;
    vehicleNumber?: string;
  };
  items: Array<{
    partNumber: string;
    description: string;
    quantity: number;
  }>;
  trackingHistory: TrackingLocationEvent[];
}

export interface TrackingLocationEvent {
  lat: number;
  lng: number;
  timestamp: string;
  address: string;
  status: string;
  notes?: string;
}

export interface LocationUpdate {
  orderId: string;
  latitude: number;
  longitude: number;
  status?: string;
  notes?: string;
  address?: string;
  timestamp?: string;
}

/**
 * Fetch delivery orders for tracking
 */
export async function getDeliveryOrdersForTracking(
  projectId: string,
  filters?: {
    from?: string;
    to?: string;
    status?: string[];
  }
): Promise<TrackingData[]> {
  try {
    let query = supabaseAdmin
      .from('delivery_orders')
      .select(`
        *,
        delivery_addresses!delivery_orders_delivery_address_id_fkey (
          id,
          company_name,
          contact_person,
          contact_phone,
          street,
          city,
          state,
          country,
          postal_code,
          latitude,
          longitude
        ),
        carriers!delivery_orders_carrier_id_fkey (
          id,
          name,
          code,
          contact_phone,
          contact_email
        ),
        delivery_tracking (
          id,
          latitude,
          longitude,
          address,
          status,
          notes,
          timestamp,
          created_by
        )
      `)
      .eq('project_id', projectId)
      .neq('status', 'draft')
      .order('created_at', { ascending: false });

    // Apply date filters
    if (filters?.from) {
      query = query.gte('created_at', filters.from);
    }
    if (filters?.to) {
      query = query.lte('created_at', filters.to);
    }

    // Apply status filters
    if (filters?.status && filters.status.length > 0) {
      query = query.in('status', filters.status);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Database error fetching delivery orders:', error);
      throw new Error(`Failed to fetch delivery orders: ${error.message}`);
    }

    return (orders || []).map(transformOrderToTrackingData);
  } catch (error) {
    console.error('Error fetching delivery orders for tracking:', error);
    throw error;
  }
}

/**
 * Get specific delivery order tracking data
 */
export async function getDeliveryOrderTracking(orderId: string): Promise<TrackingData | null> {
  try {
    const { data: order, error } = await supabaseAdmin
      .from('delivery_orders')
      .select(`
        *,
        delivery_addresses!delivery_orders_delivery_address_id_fkey (
          id,
          company_name,
          contact_person,
          contact_phone,
          street,
          city,
          state,
          country,
          postal_code,
          latitude,
          longitude
        ),
        carriers!delivery_orders_carrier_id_fkey (
          id,
          name,
          code,
          contact_phone,
          contact_email
        ),
        delivery_tracking (
          id,
          latitude,
          longitude,
          address,
          status,
          notes,
          timestamp,
          created_by
        )
      `)
      .eq('id', orderId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Order not found
      }
      console.error('Database error fetching order tracking:', error);
      throw new Error(`Failed to fetch order tracking: ${error.message}`);
    }

    return order ? transformOrderToTrackingData(order) : null;
  } catch (error) {
    console.error('Error fetching order tracking:', error);
    throw error;
  }
}

/**
 * Update delivery location with real-time tracking
 */
export async function updateDeliveryLocation(update: LocationUpdate): Promise<{
  success: boolean;
  trackingId: string;
  timestamp: string;
}> {
  try {
    const timestamp = update.timestamp || new Date().toISOString();
    
    // Validate delivery order exists
    const { data: order, error: orderError } = await supabaseAdmin
      .from('delivery_orders')
      .select('id, status, project_id')
      .eq('id', update.orderId)
      .single();

    if (orderError || !order) {
      throw new Error('Delivery order not found');
    }

    // Insert tracking event
    const { data: trackingData, error: trackingError } = await supabaseAdmin
      .from('delivery_tracking')
      .insert({
        delivery_order_id: update.orderId,
        latitude: update.latitude,
        longitude: update.longitude,
        address: update.address || `${update.latitude}, ${update.longitude}`,
        status: update.status || 'Location Update',
        notes: update.notes,
        event_timestamp: timestamp,
        created_by: 'system' // In production, get from auth context
      })
      .select('id')
      .single();

    if (trackingError) {
      console.error('Error inserting tracking data:', trackingError);
      throw new Error(`Failed to insert tracking data: ${trackingError.message}`);
    }

    // Update delivery order with latest location and timestamp
    const { error: updateError } = await supabaseAdmin
      .from('delivery_orders')
      .update({
        last_location_update: timestamp,
        updated_at: timestamp
      })
      .eq('id', update.orderId);

    if (updateError) {
      console.error('Error updating delivery order:', updateError);
      // Don't fail the entire operation if order update fails
    }

    return {
      success: true,
      trackingId: trackingData.id,
      timestamp: timestamp
    };
  } catch (error) {
    console.error('Error updating delivery location:', error);
    throw error;
  }
}

/**
 * Get latest location for specific order
 */
export async function getLatestOrderLocation(orderId: string): Promise<{
  orderId: string;
  orderNumber: string;
  status: string;
  currentLocation?: TrackingLocationEvent;
  trackingHistory: TrackingLocationEvent[];
  lastUpdate: string;
} | null> {
  try {
    const { data: order, error: orderError } = await supabaseAdmin
      .from('delivery_orders')
      .select(`
        id,
        order_number,
        status,
        last_location_update,
        delivery_tracking (
          latitude,
          longitude,
          address,
          status,
          notes,
          event_timestamp
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return null;
    }

    const trackingHistory = (order.delivery_tracking || [])
      .map((event: any) => ({
        lat: event.latitude,
        lng: event.longitude,
        timestamp: event.event_timestamp,
        address: event.address || 'Unknown location',
        status: event.status,
        notes: event.notes
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const currentLocation = trackingHistory.length > 0 ? trackingHistory[0] : undefined;

    return {
      orderId: order.id,
      orderNumber: order.order_number,
      status: order.status,
      currentLocation,
      trackingHistory,
      lastUpdate: order.last_location_update || new Date().toISOString()
    };
  } catch (error) {
    console.error('Error fetching latest location:', error);
    throw error;
  }
}

/**
 * Transform delivery order to tracking data format
 */
function transformOrderToTrackingData(order: any): TrackingData {
  const address = order.delivery_addresses;
  const carrier = order.carriers;
  const tracking = order.delivery_tracking || [];

  // Sort tracking events by timestamp (newest first)
  const trackingHistory = tracking
    .map((event: any) => ({
      lat: event.latitude,
      lng: event.longitude,
      timestamp: event.event_timestamp,
      address: event.address || 'Unknown location',
      status: event.status,
      notes: event.notes
    }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const currentLocation = trackingHistory.length > 0 
    ? {
        lat: trackingHistory[0].lat,
        lng: trackingHistory[0].lng,
        timestamp: trackingHistory[0].timestamp
      }
    : undefined;

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: mapOrderStatusToTrackingStatus(order.status),
    priority: order.priority || 'standard',
    estimatedDelivery: order.estimated_delivery_date || order.requested_delivery_date || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    actualDelivery: order.actual_delivery_date,
    customer: {
      name: address?.company_name || address?.contact_person || 'Customer',
      phone: address?.contact_phone || 'Not provided',
      address: formatAddress(address)
    },
    origin: {
      lat: 28.6139, // Default manufacturing location
      lng: 77.2090,
      address: 'Manufacturing Hub, Delhi NCR'
    },
    destination: {
      lat: address?.latitude || 28.4595,
      lng: address?.longitude || 77.0266,
      address: formatAddress(address)
    },
    currentLocation,
    carrier: {
      name: carrier?.name || 'Local Courier',
      trackingNumber: order.tracking_number || `TRK${order.order_number.slice(-8)}`,
      driverName: order.driver_name,
      driverPhone: order.driver_phone,
      vehicleNumber: order.vehicle_number
    },
    items: (order.items || []).map((item: any) => ({
      partNumber: item.partNumber,
      description: item.description || item.partNumber,
      quantity: item.deliveryQuantity || item.quantity || 1
    })),
    trackingHistory
  };
}

/**
 * Map order status to tracking status
 */
function mapOrderStatusToTrackingStatus(orderStatus: string): TrackingData['status'] {
  const statusMap: Record<string, TrackingData['status']> = {
    'pending': 'pending',
    'pending_approval': 'pending',
    'approved': 'pickup',
    'in_transit': 'in_transit',
    'out_for_delivery': 'out_for_delivery',
    'delivered': 'delivered',
    'failed_delivery': 'failed',
    'returned': 'failed',
    'cancelled': 'failed'
  };
  
  return statusMap[orderStatus] || 'pending';
}

/**
 * Format delivery address
 */
function formatAddress(address: any): string {
  if (!address) return 'Address not available';
  
  const parts = [
    address.street,
    address.city,
    address.state,
    address.country,
    address.postal_code
  ].filter(Boolean);
  
  return parts.join(', ');
}

/**
 * Get external tracking URL for carrier
 */
export function getExternalTrackingUrl(carrierName: string, trackingNumber: string): string | null {
  if (!trackingNumber) return null;
  
  // Try to detect carrier from tracking number or use the carrier name
  const detectedCarrier = carrierTrackingService.detectCarrierFromTrackingNumber(trackingNumber);
  const carrierCode = detectedCarrier || 
                     carrierName.toLowerCase().replace(/\s+/g, '') ||
                     'delhivery';
  
  return carrierTrackingService.getCarrierTrackingUrl(carrierCode, trackingNumber);
}