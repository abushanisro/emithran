import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/server/auth';

// Simple in-memory store for balloon annotations
// In production, this would be stored in a database
// Keyed by user and file: a file id alone would let anyone read, overwrite or delete another user's annotations.
const annotationStore = new Map<string, any[]>();
const storeKey = (userId: string, fileId: string) => `${userId}:${fileId}`;

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json(
        { error: 'fileId parameter is required' },
        { status: 400 }
      );
    }

    const annotations = annotationStore.get(storeKey(auth.userId, fileId)) || [];
    
    return NextResponse.json({
      success: true,
      data: annotations
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch annotations' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { fileId, balloons } = body;

    if (!fileId) {
      return NextResponse.json(
        { error: 'fileId is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(balloons)) {
      return NextResponse.json(
        { error: 'balloons must be an array' },
        { status: 400 }
      );
    }

    // Validate balloon structure
    for (const balloon of balloons) {
      if (!balloon.id || typeof balloon.number !== 'number' || 
          typeof balloon.x !== 'number' || typeof balloon.y !== 'number') {
        return NextResponse.json(
          { error: 'Invalid balloon structure' },
          { status: 400 }
        );
      }
    }

    // Store the annotations
    annotationStore.set(storeKey(auth.userId, fileId), balloons);


    return NextResponse.json({
      success: true,
      data: {
        fileId,
        balloonCount: balloons.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to save annotations' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const searchParams = request.nextUrl.searchParams;
    const fileId = searchParams.get('fileId');

    if (!fileId) {
      return NextResponse.json(
        { error: 'fileId parameter is required' },
        { status: 400 }
      );
    }

    annotationStore.delete(storeKey(auth.userId, fileId));

    return NextResponse.json({
      success: true,
      message: `Annotations for file ${fileId} deleted`
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete annotations' },
      { status: 500 }
    );
  }
}