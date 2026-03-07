import { NextRequest, NextResponse } from 'next/server';
import { updateDeliveryLocation, getLatestOrderLocation } from '@/lib/api/delivery-tracking';

// POST /api/delivery/tracking/[orderId]/location - Update delivery location
export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params;
    const body = await request.json();
    const { lat, lng, status, notes, address } = body;

    if (!orderId || typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json(
        { 
          success: false,
          error: {
            message: 'Order ID, latitude, and longitude are required',
            code: 'INVALID_REQUEST_DATA'
          }
        },
        { status: 400 }
      );
    }

    // Validate coordinates
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
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

    // Update location in Supabase database
    const result = await updateDeliveryLocation({
      orderId,
      latitude: lat,
      longitude: lng,
      status: status || 'Location Update',
      notes,
      address: address || `${lat}, ${lng}`,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      data: {
        orderId,
        trackingId: result.trackingId,
        location: { lat, lng },
        status: status || 'Location Update',
        notes,
        address: address || `${lat}, ${lng}`,
        timestamp: result.timestamp,
        updated: result.success
      }
    });

  } catch (error) {
    console.error('Error updating tracking location:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to update location',
          code: 'LOCATION_UPDATE_FAILED'
        }
      },
      { status: 500 }
    );
  }
}

// GET /api/delivery/tracking/[orderId]/location - Get latest location for an order
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = params;

    if (!orderId) {
      return NextResponse.json(
        { 
          success: false,
          error: {
            message: 'Order ID is required',
            code: 'MISSING_ORDER_ID'
          }
        },
        { status: 400 }
      );
    }

    // Fetch latest location from Supabase
    const locationData = await getLatestOrderLocation(orderId);

    if (!locationData) {
      return NextResponse.json(
        { 
          success: false,
          error: {
            message: 'Order not found',
            code: 'ORDER_NOT_FOUND'
          }
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: locationData
    });

  } catch (error) {
    console.error('Error fetching tracking location:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to fetch location',
          code: 'LOCATION_FETCH_FAILED'
        }
      },
      { status: 500 }
    );
  }
}