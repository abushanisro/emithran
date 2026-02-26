'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, Download, Eye, Settings } from 'lucide-react';
import { toast } from 'sonner';

interface ExtractedDimension {
  id: string;
  value: string;
  unit: string;
  position: { x: number; y: number };
  type: 'linear' | 'angular' | 'radial';
  tolerance?: {
    upper: string;
    lower: string;
  };
}

interface BalloonAnnotation {
  id: string;
  number: number;
  dimension: ExtractedDimension;
  balloonPosition: { x: number; y: number };
}

export function AutoBalloonExtractor({ 
  pdfUrl, 
  onDimensionsExtracted 
}: { 
  pdfUrl: string;
  onDimensionsExtracted?: (dimensions: ExtractedDimension[]) => void;
}) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedDimensions, setExtractedDimensions] = useState<ExtractedDimension[]>([]);
  const [balloonAnnotations, setBalloonAnnotations] = useState<BalloonAnnotation[]>([]);
  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('');
  const [pdfInfo, setPdfInfo] = useState<{
    isVectorBased?: boolean;
    pageCount?: number;
    estimatedTime?: number;
  }>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Main extraction function
  const extractDimensionsFromPDF = async () => {
    if (!pdfUrl) {
      toast.error('No PDF URL provided');
      return;
    }

    setIsProcessing(true);
    setProcessingStatus('Initializing industry-standard PDF processing pipeline...');
    
    try {
      // Step 1: Validate PDF and detect type
      setProcessingStatus('Validating PDF structure with pdf-lib...');
      const validationResponse = await fetch('/api/pdf-to-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfUrl })
      });

      if (!validationResponse.ok) {
        const errorData = await validationResponse.json();
        throw new Error(errorData.error || 'PDF validation failed');
      }

      const validationData = await validationResponse.json();
      setPdfInfo({
        isVectorBased: validationData.isVectorBased,
        pageCount: validationData.pageCount,
        estimatedTime: validationData.estimatedProcessingTime
      });

      // Step 2: Extract dimensions using production pipeline
      setProcessingStatus('Processing PDF with industry-standard algorithms...');
      const extractionResponse = await fetch('/api/extract-dimensions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          pdfUrl,
          extractionConfig: {
            // Production OCR configuration
            tesseractConfig: {
              lang: 'eng',
              oem: 1,
              psm: 6,
              whitelist: '0123456789.+-±∅⌀RΦφ°′″mmcminftMM'
            },
            // Dimension patterns for engineering drawings
            dimensionPatterns: [
              /(\\d+\\.?\\d*)\\s*(?:mm|cm|m|in|ft|″|′)/gi,
              /R\\s*(\\d+\\.?\\d*)/gi,
              /∅\\s*(\\d+\\.?\\d*)/gi,
              /(\\d+\\.?\\d*)°/gi,
              /(\\d+\\.?\\d*)\\s*[±]\\s*(\\d+\\.?\\d*)/gi
            ]
          }
        })
      });

      if (!extractionResponse.ok) {
        const errorData = await extractionResponse.json();
        throw new Error(errorData.error || 'Dimension extraction failed');
      }

      const extractedDimensions = await extractionResponse.json();
      
      if (!extractedDimensions || extractedDimensions.length === 0) {
        throw new Error('No dimensions detected in PDF. Please ensure the PDF contains readable dimension text.');
      }

      setProcessingStatus('Generating balloon annotations...');
      const balloons = generateBalloonAnnotations(extractedDimensions);
      
      setExtractedDimensions(extractedDimensions);
      setBalloonAnnotations(balloons);
      setProcessingStatus('');
      
      // Callback to parent component
      if (onDimensionsExtracted) {
        onDimensionsExtracted(extractedDimensions);
      }
      
      toast.success(`Successfully extracted ${extractedDimensions.length} dimensions with ${balloons.length} balloons`, {
        duration: 4000
      });
      
    } catch (error) {
      console.error('Dimension extraction failed:', error);
      setProcessingStatus('');
      toast.error(error instanceof Error ? error.message : 'Failed to extract dimensions');
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate balloon annotations for extracted dimensions
  const generateBalloonAnnotations = (dimensions: ExtractedDimension[]): BalloonAnnotation[] => {
    return dimensions.map((dim, index) => ({
      id: `balloon-${dim.id}`,
      number: index + 1,
      dimension: dim,
      balloonPosition: calculateBalloonPosition(dim.position, index)
    }));
  };

  // Calculate optimal balloon position (avoid overlaps)
  const calculateBalloonPosition = (dimPosition: { x: number; y: number }, index: number) => {
    const balloonRadius = 20;
    const offsetDistance = 50;
    
    // Spiral placement to avoid overlaps
    const angle = (index * 45) % 360;
    const radians = (angle * Math.PI) / 180;
    
    return {
      x: dimPosition.x + Math.cos(radians) * offsetDistance,
      y: dimPosition.y + Math.sin(radians) * offsetDistance
    };
  };

  // Create annotated image with balloons
  const createAnnotatedImage = async (imageData: ImageData, balloons: BalloonAnnotation[]): Promise<string> => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    ctx.putImageData(imageData, 0, 0);
    
    // Draw balloons
    balloons.forEach(balloon => {
      // Draw balloon circle
      ctx.beginPath();
      ctx.arc(balloon.balloonPosition.x, balloon.balloonPosition.y, 20, 0, 2 * Math.PI);
      ctx.fillStyle = '#3B82F6';
      ctx.fill();
      ctx.strokeStyle = '#1E40AF';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw balloon number
      ctx.fillStyle = 'white';
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(
        balloon.number.toString(),
        balloon.balloonPosition.x,
        balloon.balloonPosition.y + 5
      );
      
      // Draw leader line
      ctx.beginPath();
      ctx.moveTo(balloon.balloonPosition.x, balloon.balloonPosition.y);
      ctx.lineTo(balloon.dimension.position.x, balloon.dimension.position.y);
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    
    return canvas.toDataURL('image/png');
  };

  // Export balloon drawing data
  const exportBalloonData = () => {
    const exportData = {
      extractedDimensions,
      balloonAnnotations,
      metadata: {
        extractedAt: new Date().toISOString(),
        totalDimensions: extractedDimensions.length,
        pdfSource: pdfUrl
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'balloon-drawing-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Automatic Balloon Drawing Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* PDF Information */}
          {pdfInfo.isVectorBased !== undefined && (
            <div className="p-3 bg-muted rounded-lg border">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <span className="font-medium">Type:</span>
                    <Badge variant={pdfInfo.isVectorBased ? "default" : "secondary"}>
                      {pdfInfo.isVectorBased ? "Vector PDF" : "Scanned PDF"}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium">Pages:</span>
                    <span>{pdfInfo.pageCount}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-medium">Est. Time:</span>
                    <span>{Math.round((pdfInfo.estimatedTime || 0) / 1000)}s</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Processing Status */}
          {processingStatus && (
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                <span className="text-sm text-blue-800">{processingStatus}</span>
              </div>
            </div>
          )}

          {/* Control Buttons */}
          <div className="flex gap-3">
            <Button 
              onClick={extractDimensionsFromPDF}
              disabled={isProcessing || !pdfUrl}
              className="flex items-center gap-2"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {isProcessing ? 'Processing PDF...' : 'Extract & Generate Balloons'}
            </Button>

            {balloonAnnotations.length > 0 && (
              <>
                <Button variant="outline" onClick={exportBalloonData}>
                  <Download className="h-4 w-4 mr-2" />
                  Export Data
                </Button>
                <Button variant="outline">
                  <Eye className="h-4 w-4 mr-2" />
                  Preview Report
                </Button>
              </>
            )}
          </div>

          {/* Results Summary */}
          {extractedDimensions.length > 0 && (
            <div className="flex gap-2">
              <Badge variant="secondary">
                {extractedDimensions.length} Dimensions Found
              </Badge>
              <Badge variant="secondary">
                {balloonAnnotations.length} Balloons Generated
              </Badge>
            </div>
          )}

          {/* Processed Image Display */}
          {processedImageUrl && (
            <div className="border rounded-lg p-4 bg-muted">
              <img 
                src={processedImageUrl} 
                alt="Annotated Drawing with Balloons"
                className="max-w-full h-auto"
              />
            </div>
          )}

          {/* Hidden canvas for image processing */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />

          {/* Extracted Dimensions List */}
          {extractedDimensions.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Extracted Dimensions:</h4>
              <div className="grid gap-2 max-h-40 overflow-y-auto">
                {balloonAnnotations.map(balloon => (
                  <div key={balloon.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                    <span className="font-mono">
                      {balloon.number}. {balloon.dimension.value} {balloon.dimension.unit}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {balloon.dimension.type}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}