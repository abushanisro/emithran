/**
 * CAD Engine React Hook
 * 
 * Provides React integration for CAD file conversion
 * Handles loading states, error handling, and progress tracking
 */

import { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { cadEngineClient, ConversionResult, CADEngineHealth } from '../cad-engine';

interface ConversionState {
  isConverting: boolean;
  progress: number;
  error: string | null;
}

interface ConversionOptions {
  downloadAfterConversion?: boolean;
  returnBase64?: boolean;
}

export const useCadEngine = () => {
  const [conversionState, setConversionState] = useState<ConversionState>({
    isConverting: false,
    progress: 0,
    error: null,
  });

  // Health check query
  const {
    data: healthStatus,
    isLoading: isHealthLoading,
    error: healthError,
    refetch: checkHealth
  } = useQuery({
    queryKey: ['cad-engine-health'],
    queryFn: () => cadEngineClient.getHealthStatus(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 3,
    retryDelay: 1000,
  });

  // Binary STL conversion mutation
  const stlConversionMutation = useMutation({
    mutationFn: async (file: File): Promise<Blob> => {
      setConversionState({
        isConverting: true,
        progress: 0,
        error: null,
      });

      try {
        // Simulate progress for better UX
        const progressInterval = setInterval(() => {
          setConversionState(prev => ({
            ...prev,
            progress: Math.min(prev.progress + 10, 90),
          }));
        }, 500);

        const result = await cadEngineClient.convertToStl(file);
        
        clearInterval(progressInterval);
        setConversionState({
          isConverting: false,
          progress: 100,
          error: null,
        });

        return result;
      } catch (error) {
        setConversionState({
          isConverting: false,
          progress: 0,
          error: error instanceof Error ? error.message : 'Conversion failed',
        });
        throw error;
      }
    },
    onSuccess: (blob, file) => {
      // Auto-download the converted file
      cadEngineClient.downloadStlBlob(blob, file.name);
    },
  });

  // Base64 STL conversion mutation
  const base64ConversionMutation = useMutation({
    mutationFn: async (file: File): Promise<ConversionResult> => {
      setConversionState({
        isConverting: true,
        progress: 0,
        error: null,
      });

      try {
        const progressInterval = setInterval(() => {
          setConversionState(prev => ({
            ...prev,
            progress: Math.min(prev.progress + 10, 90),
          }));
        }, 500);

        const result = await cadEngineClient.convertToStlBase64(file);
        
        clearInterval(progressInterval);
        setConversionState({
          isConverting: false,
          progress: 100,
          error: null,
        });

        return result;
      } catch (error) {
        setConversionState({
          isConverting: false,
          progress: 0,
          error: error instanceof Error ? error.message : 'Conversion failed',
        });
        throw error;
      }
    },
  });

  // Convert and download STL file
  const convertToStl = useCallback(
    async (file: File, options: ConversionOptions = {}) => {
      const { downloadAfterConversion = true, returnBase64 = false } = options;

      try {
        if (returnBase64) {
          const result = await base64ConversionMutation.mutateAsync(file);
          if (downloadAfterConversion) {
            cadEngineClient.downloadStlBase64(result.stlBase64, file.name);
          }
          return result;
        } else {
          const blob = await stlConversionMutation.mutateAsync(file);
          return blob;
        }
      } catch (error) {
        console.error('CAD conversion error:', error);
        throw error;
      }
    },
    [stlConversionMutation, base64ConversionMutation]
  );

  // Validate file before conversion
  const validateFile = useCallback((file: File) => {
    return cadEngineClient.validateFile(file);
  }, []);

  // Check if file format is supported
  const isFileSupported = useCallback((filename: string) => {
    return cadEngineClient.isFileSupported(filename);
  }, []);

  // Reset conversion state
  const resetConversionState = useCallback(() => {
    setConversionState({
      isConverting: false,
      progress: 0,
      error: null,
    });
  }, []);

  return {
    // State
    ...conversionState,
    healthStatus,
    isHealthLoading,
    healthError,
    isEngineHealthy: healthStatus?.status === 'healthy',

    // Actions
    convertToStl,
    validateFile,
    isFileSupported,
    resetConversionState,
    checkHealth,

    // Utilities
    supportedFormats: cadEngineClient['supportedFormats'],
    maxFileSize: cadEngineClient['maxFileSize'],
  };
};