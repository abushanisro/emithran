import { useState, useCallback, useEffect } from 'react';

export interface Balloon {
  id: string;
  number: number;
  x: number;
  y: number;
  timestamp: number;
}

interface UseBalloonAnnotationsProps {
  fileId: string;
  autoLoad?: boolean;
}

export function useBalloonAnnotations({ fileId, autoLoad = false }: UseBalloonAnnotationsProps) {
  const [balloons, setBalloons] = useState<Balloon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load balloons from API
  const loadBalloons = useCallback(async () => {
    if (!fileId) return;
    
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/balloon-annotations?fileId=${encodeURIComponent(fileId)}`);
      const data = await response.json();

      if (data.success) {
        setBalloons(data.data || []);
      } else {
        throw new Error(data.error || 'Failed to load annotations');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load annotations';
      setError(errorMessage);
      console.error('Error loading balloon annotations:', err);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  // Save balloons to API
  const saveBalloons = useCallback(async (balloonsToSave: Balloon[]) => {
    if (!fileId) {
      throw new Error('File ID is required');
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/balloon-annotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileId,
          balloons: balloonsToSave,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setBalloons(balloonsToSave);
        return data.data;
      } else {
        throw new Error(data.error || 'Failed to save annotations');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save annotations';
      setError(errorMessage);
      console.error('Error saving balloon annotations:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  // Delete all balloons for this file
  const deleteBalloons = useCallback(async () => {
    if (!fileId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/balloon-annotations?fileId=${encodeURIComponent(fileId)}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        setBalloons([]);
      } else {
        throw new Error(data.error || 'Failed to delete annotations');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete annotations';
      setError(errorMessage);
      console.error('Error deleting balloon annotations:', err);
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  // Auto-load on mount if enabled
  useEffect(() => {
    if (autoLoad && fileId) {
      loadBalloons();
    }
  }, [autoLoad, fileId, loadBalloons]);

  return {
    balloons,
    loading,
    error,
    loadBalloons,
    saveBalloons,
    deleteBalloons,
    setBalloons, // For local state updates
  };
}