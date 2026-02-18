'use client';

import React, { useState, useCallback } from 'react';
import { useCadEngine } from '@/lib/api/hooks';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, Download, Zap } from 'lucide-react';

interface CadConverterProps {
  onConversionComplete?: (result: any) => void;
  className?: string;
}

export const CadConverter: React.FC<CadConverterProps> = ({
  onConversionComplete,
  className
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  
  const {
    isConverting,
    progress,
    error,
    convertToStl,
    validateFile,
    isFileSupported,
    resetConversionState,
    supportedFormats,
    maxFileSize,
    healthStatus,
    isEngineHealthy
  } = useCadEngine();

  // Handle file selection
  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    const file = files[0];
    const validation = validateFile(file);
    
    if (!validation.valid) {
      alert(validation.error);
      return;
    }
    
    setSelectedFile(file);
    resetConversionState();
  }, [validateFile, resetConversionState]);

  // Handle drag events
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files);
    }
  }, [handleFileSelect]);

  // Handle conversion
  const handleConvert = useCallback(async () => {
    if (!selectedFile) return;
    
    try {
      const result = await convertToStl(selectedFile, {
        downloadAfterConversion: true,
        returnBase64: false
      });
      
      onConversionComplete?.(result);
    } catch (error) {
      console.error('Conversion failed:', error);
    }
  }, [selectedFile, convertToStl, onConversionComplete]);

  const formatFileSize = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-blue-600" />
              CAD File Converter
            </CardTitle>
            <CardDescription>
              Convert STEP/IGES files to STL using OpenCascade Technology
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isEngineHealthy ? (
              <Badge variant="default" className="bg-green-100 text-green-800">
                Engine Online
              </Badge>
            ) : (
              <Badge variant="destructive">Engine Offline</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Engine Status */}
        {healthStatus && (
          <div className="text-sm text-gray-600">
            <p><strong>OpenCascade:</strong> {healthStatus.opencascade}</p>
            <p><strong>Supported Formats:</strong> {healthStatus.capabilities.join(', ')}</p>
            <p><strong>Max File Size:</strong> {healthStatus.limits.maxFileSizeMb} MB</p>
          </div>
        )}

        {/* File Upload Area */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive 
              ? 'border-blue-400 bg-blue-50' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <div className="space-y-2">
            <p className="text-lg font-medium">
              {selectedFile ? selectedFile.name : 'Drop your CAD file here'}
            </p>
            <p className="text-sm text-gray-500">
              Supported formats: {supportedFormats.join(', ')}
            </p>
            <p className="text-xs text-gray-400">
              Maximum size: {formatFileSize(maxFileSize)}
            </p>
          </div>
          
          {!selectedFile && (
            <>
              <div className="mt-4">
                <Button
                  variant="outline"
                  onClick={() => document.getElementById('file-input')?.click()}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Browse Files
                </Button>
              </div>
              
              <input
                id="file-input"
                type="file"
                className="hidden"
                accept={supportedFormats.join(',')}
                onChange={(e) => handleFileSelect(e.target.files)}
              />
            </>
          )}
        </div>

        {/* Selected File Info */}
        {selectedFile && (
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{selectedFile.name}</p>
                <p className="text-sm text-gray-500">
                  {formatFileSize(selectedFile.size)} • {selectedFile.type || 'CAD File'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedFile(null)}
              >
                Remove
              </Button>
            </div>
          </div>
        )}

        {/* Conversion Progress */}
        {isConverting && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Converting to STL...</span>
              <span className="text-sm text-gray-500">{progress}%</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Convert Button */}
        <div className="flex gap-2">
          <Button
            onClick={handleConvert}
            disabled={!selectedFile || isConverting || !isEngineHealthy}
            className="flex-1"
          >
            {isConverting ? (
              'Converting...'
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Convert to STL
              </>
            )}
          </Button>
          
          {selectedFile && (
            <Button
              variant="outline"
              onClick={() => {
                setSelectedFile(null);
                resetConversionState();
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Info */}
        <div className="text-xs text-gray-500 border-t pt-4">
          <p>• Binary STL format for optimal file size</p>
          <p>• Professional OpenCascade Technology (same as CATIA, FreeCAD)</p>
          <p>• Automatic mesh generation with quality optimization</p>
        </div>
      </CardContent>
    </Card>
  );
};