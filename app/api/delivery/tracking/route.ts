import { NextRequest, NextResponse } from 'next/server';
import { 
  updateDeliveryLocation 
} from '@/lib/api/delivery-tracking';
import { addressGeocodingService } from '@/lib/services/address-geocoding';
import { carrierTrackingService } from '@/lib/services/carrier-tracking';

// Helper functions
function mapOrderStatusToTrackingStatus(orderStatus: string) {
  const statusMap: Record<string, string> = {
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

function mapCarrierStatusToTrackingStatus(carrierStatus: 'in_transit' | 'delivered' | 'exception' | 'unknown'): string {
  const statusMap: Record<string, string> = {
    'in_transit': 'in_transit',
    'delivered': 'delivered',
    'exception': 'failed',
    'unknown': 'pending'
  };
  return statusMap[carrierStatus] || 'pending';
}

function formatAddress(address: any): string {
  if (!address) return 'Address not available';
  const parts = [
    address.addressLine1 || address.street,
    address.city,
    address.stateProvince || address.state,
    address.country,
    address.postalCode
  ].filter(Boolean);
  return parts.join(', ');
}

async function transformBackendOrderToTrackingData(order: any) {
  try {
    // Use actual delivery address data from the order
    const deliveryAddress = order.deliveryAddress;
    const pickupAddress = order.pickupAddress || {
      // Use project location or company address as pickup
      addressLine1: order.projectName || 'Manufacturing Location',
      city: 'Delhi',
      state: 'Delhi',
      country: 'India'
    };

    // Geocode addresses if coordinates are missing
    let originCoords = null;
    let destinationCoords = null;

    // Only geocode if coordinates are not already available
    if (!deliveryAddress?.latitude || !deliveryAddress?.longitude) {
      destinationCoords = await addressGeocodingService.geocodeAddress({
        addressLine1: deliveryAddress?.addressLine1 || deliveryAddress?.street || '',
        city: deliveryAddress?.city || '',
        state: deliveryAddress?.stateProvince || deliveryAddress?.state,
        country: deliveryAddress?.country || 'India',
        postalCode: deliveryAddress?.postalCode
      });
    } else {
      destinationCoords = {
        lat: deliveryAddress.latitude,
        lng: deliveryAddress.longitude
      };
    }

    // Geocode pickup address
    originCoords = await addressGeocodingService.geocodeAddress(pickupAddress);

    // Get real carrier tracking data if tracking number exists
    let carrierTrackingData = null;
    if (order.trackingNumber) {
      carrierTrackingData = await carrierTrackingService.trackShipment(order.trackingNumber, order.carrier?.code);
    }

    // Use real carrier tracking status if available
    const deliveryStatus = carrierTrackingData ? 
      mapCarrierStatusToTrackingStatus(carrierTrackingData.status) :
      mapOrderStatusToTrackingStatus(order.status);

    // Extract current location from carrier tracking events
    let currentLocation = undefined;
    if (carrierTrackingData?.events && carrierTrackingData.events.length > 0) {
      const latestEvent = carrierTrackingData.events[0];
      if (latestEvent.coordinates) {
        currentLocation = {
          lat: latestEvent.coordinates.lat,
          lng: latestEvent.coordinates.lng,
          timestamp: latestEvent.timestamp,
          status: latestEvent.status
        };
      }
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: deliveryStatus,
      priority: order.priority || 'standard',
      estimatedDelivery: carrierTrackingData?.estimatedDelivery || 
                        order.estimatedDeliveryDate || 
                        order.requestedDeliveryDate || 
                        new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      actualDelivery: order.actualDeliveryDate,
      customer: {
        name: deliveryAddress?.companyName || deliveryAddress?.contactPerson || 'Customer',
        phone: deliveryAddress?.contactPhone || 'Not provided',
        address: formatAddress(deliveryAddress)
      },
      origin: {
        lat: originCoords?.lat || null,
        lng: originCoords?.lng || null,
        address: formatAddress(pickupAddress)
      },
      destination: {
        lat: destinationCoords?.lat || null,
        lng: destinationCoords?.lng || null,
        address: formatAddress(deliveryAddress)
      },
      currentLocation: currentLocation,
      carrier: {
        name: carrierTrackingData?.carrier || order.carrier?.name || 'Local Courier',
        trackingNumber: order.trackingNumber || `TRK${(order.orderNumber || 'UNKNOWN').slice(-8)}`,
        driverName: order.driverName,
        driverPhone: order.driverPhone,
        vehicleNumber: order.vehicleNumber,
        trackingUrl: order.trackingNumber ? 
          carrierTrackingService.getCarrierTrackingUrl(
            carrierTrackingData?.carrier?.toLowerCase() || 'unknown', 
            order.trackingNumber
          ) : null
      },
      items: (order.items || []).map((item: any) => ({
        partNumber: item.partNumber || 'Unknown',
        description: item.description || item.partNumber || 'Unknown',
        quantity: item.deliveryQuantity || item.quantity || 1
      })),
      trackingHistory: carrierTrackingData?.events || []
    };
  } catch (error) {
    console.error('Error transforming order:', error, 'Order data:', order);
    throw new Error(`Failed to transform order data: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// GET /api/delivery/tracking - Get all delivery tracking data for a project
export async function GET(request: NextRequest) {
  try {
    console.log('=== TRACKING API CALLED ===');
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const status = searchParams.getAll('status');
    
    console.log('Request params:', { projectId, from, to, status });

    if (!projectId) {
      console.log('Missing project ID');
      return NextResponse.json(
        { 
          success: false,
          error: { 
            message: 'Project ID is required',
            code: 'MISSING_PROJECT_ID'
          }
        },
        { status: 400 }
      );
    }

    // Call the working backend API
    const backendUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL || 'http://localhost:4000';
    const params = new URLSearchParams();
    params.append('projectId', projectId);
    if (from) params.append('startDate', from);
    if (to) params.append('endDate', to);
    status.forEach(s => params.append('status', s));

    console.log('Calling backend API:', `${backendUrl}/v1/api/delivery/orders?${params.toString()}`);
    
    const response = await fetch(`${backendUrl}/v1/api/delivery/orders?${params.toString()}`);
    console.log('Backend response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Backend API error:', response.status, response.statusText, errorText);
      throw new Error(`Backend API error: ${response.status} ${response.statusText}`);
    }
    
    const backendData = await response.json();
    console.log('Backend data received:', backendData);
    
    // Backend returns nested structure: { data: { data: [...] } }
    const ordersArray = backendData.data?.data || [];
    console.log('Orders array:', ordersArray);
    
    // Transform orders with proper address handling
    const deliveries = await Promise.all(
      ordersArray.map(order => transformBackendOrderToTrackingData(order))
    );
    console.log('Transformed deliveries:', deliveries.length, 'items');

    return NextResponse.json({
      success: true,
      data: {
        deliveries,
        pagination: {
          total: deliveries.length,
          page: 1,
          limit: 20
        }
      }
    });

  } catch (error) {
    console.error('Tracking API error:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    return NextResponse.json(
      { 
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Internal server error',
          code: 'TRACKING_FETCH_ERROR'
        }
      },
      { status: 500 }
    );
  }
}

// POST /api/delivery/tracking - Create new tracking entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, latitude, longitude, status, notes, address } = body;

    if (!orderId || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return NextResponse.json(
        { 
          success: false,
          error: {
            message: 'Order ID, latitude, and longitude are required',
            code: 'INVALID_LOCATION_DATA'
          }
        },
        { status: 400 }
      );
    }

    // Validate coordinates
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json(
        { 
          success: false,
          error: {
            message: 'Invalid coordinates provided',
            code: 'INVALID_COORDINATES'
          }
        },
        { status: 400 }
      );
    }

    // Update location in database with real-time tracking
    const result = await updateDeliveryLocation({
      orderId,
      latitude,
      longitude,
      status: status || 'Location Update',
      notes,
      address,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      data: {
        trackingId: result.trackingId,
        timestamp: result.timestamp,
        location: { latitude, longitude },
        status: status || 'Location Update',
        notes
      }
    });

  } catch (error) {
    console.error('Location update error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to update location',
          code: 'LOCATION_UPDATE_ERROR'
        }
      },
      { status: 500 }
    );
  }
}