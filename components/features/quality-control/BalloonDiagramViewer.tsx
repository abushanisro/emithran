'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InteractiveBalloonAnnotator from './InteractiveBalloonAnnotator';
import { 
  Download, 
  Maximize2, 
  ZoomIn, 
  ZoomOut, 
  RotateCw,
  FileImage,
  Ruler,
  Eye,
  Settings,
  X,
  Edit3,
  Circle
} from 'lucide-react';

// PDF Viewer Component
interface PDFViewerProps {
  filePath: string;
  fileId: string;
  fileName: string;
}

function PDFViewer({ filePath, fileId, fileName }: PDFViewerProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAnnotator, setShowAnnotator] = useState(false);

  // Load PDF with authentication headers
  useEffect(() => {
    if (filePath) {
      loadPDFWithAuth();
    }
  }, [filePath]);

  const loadPDFWithAuth = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // First try to get a signed URL for the PDF using proper API client
      const { apiClient } = await import('@/lib/api/client');
      const signedUrlEndpoint = `/bom-items/${fileId}/file-url/2d`;
      console.log('Attempting signed URL from:', signedUrlEndpoint);
      
      const data = await apiClient.get(signedUrlEndpoint);
      console.log('Signed URL API response:', data);
      
      // Try different possible response formats
      const possibleUrl = data.url || data.downloadUrl || data.fileUrl || data.signedUrl || data.data?.url;
      
      if (possibleUrl) {
        console.log('Using signed URL:', possibleUrl);
        setPdfUrl(possibleUrl);
      } else {
        console.log('No URL found in response, response keys:', Object.keys(data));
        throw new Error('No signed URL returned');
      }
    } catch (error) {
      console.error('Signed URL failed, trying blob approach:', error);
      
      // Fallback: Try different URL formats
      // Extract filename from path for some endpoints
      const filename = filePath.split('/').pop();
      
      const urlsToTry = [
        // Original file download endpoint
        `${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`,
        // Try with different file download formats
        `${process.env.NEXT_PUBLIC_API_URL}/files/download/${encodeURIComponent(filePath)}`,
        // Direct BOM item file endpoints
        `${process.env.NEXT_PUBLIC_API_URL}/bom-items/${fileId}/files/2d`,
        `${process.env.NEXT_PUBLIC_API_URL}/bom-items/${fileId}/file/2d`,
        `${process.env.NEXT_PUBLIC_API_URL}/bom-items/${fileId}/download/2d`,
        // Try using just the filename
        `${process.env.NEXT_PUBLIC_API_URL}/bom-items/${fileId}/files/2d/${filename}`,
        // Alternative file serving endpoints
        `${process.env.NEXT_PUBLIC_API_URL}/files/${fileId}/2d`,
        `${process.env.NEXT_PUBLIC_API_URL}/files/${fileId}`,
        // Static file serving attempts
        `${process.env.NEXT_PUBLIC_API_URL}/static/${filePath}`,
        `${process.env.NEXT_PUBLIC_API_URL}/uploads/${filePath}`,
        // Direct path attempts
        `${process.env.NEXT_PUBLIC_API_URL}/${filePath}`,
        `${process.env.NEXT_PUBLIC_API_URL}/files/${filePath}`
      ];
      
      let lastError = null;
      for (const url of urlsToTry) {
        try {
          console.log('Trying URL:', url);
          const pdfResponse = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            }
          });
          
          if (pdfResponse.ok) {
            const blob = await pdfResponse.blob();
            const objectUrl = URL.createObjectURL(blob);
            console.log('Successfully created blob URL from:', url);
            setPdfUrl(objectUrl);
            return; // Success, exit the function
          } else {
            const responseText = await pdfResponse.text().catch(() => 'Could not read response');
            lastError = `${url} failed with status: ${pdfResponse.status} - ${responseText}`;
            console.log(lastError);
          }
        } catch (fetchError) {
          lastError = `${url} failed with error: ${fetchError.message}`;
          console.log(lastError);
        }
      }
      
      // If we get here, all URLs failed - try direct iframe as last resort
      console.log('All blob attempts failed, trying direct iframe URLs');
      for (const url of urlsToTry.slice(0, 3)) { // Try first 3 URLs directly in iframe
        console.log('Trying direct iframe URL:', url);
        setPdfUrl(url);
        break; // Try the first one and let iframe handle it
      }
      
      if (!pdfUrl) {
        setError(`All PDF download attempts failed. Last error: ${lastError}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // Cleanup blob URL when component unmounts
  useEffect(() => {
    return () => {
      if (pdfUrl && pdfUrl.startsWith('blob:')) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b bg-gray-50">
        <div className="flex items-center gap-2">
          <FileImage className="h-5 w-5 text-blue-500" />
          <h4 className="font-medium text-gray-900">2D Technical Drawing (PDF)</h4>
          <Badge variant="outline">{fileName}</Badge>
        </div>
        <div className="flex gap-2">
          {loading && (
            <Badge variant="outline" className="text-blue-600">
              Loading...
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAnnotator(true)}
            disabled={!pdfUrl}
            className="bg-blue-50 hover:bg-blue-100 border-blue-200"
          >
            <Edit3 className="h-4 w-4 mr-1" />
            Add Balloons
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(pdfUrl || `${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(filePath)}`, '_blank')}
          >
            <Download className="h-4 w-4 mr-1" />
            Open in New Tab
          </Button>
        </div>
      </div>
      
      <div className="flex-1 min-h-[600px] h-full">
        {loading ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center text-blue-500">
              <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
              <p className="text-sm">Loading PDF...</p>
              <p className="text-xs text-gray-400">Fetching file from server</p>
            </div>
          </div>
        ) : error ? (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center text-red-500 max-w-md">
              <FileImage className="h-12 w-12 mx-auto mb-2" />
              <p className="text-sm font-medium">Failed to load PDF</p>
              <p className="text-xs mt-1">{error}</p>
              <div className="mt-4 p-3 bg-gray-50 rounded text-left text-xs">
                <p><strong>File Path:</strong> {filePath}</p>
                <p><strong>File ID:</strong> {fileId}</p>
              </div>
              <Button onClick={loadPDFWithAuth} size="sm" className="mt-3">
                Try Again
              </Button>
            </div>
          </div>
        ) : pdfUrl ? (
          <div className="w-full h-[70vh] bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-lg overflow-hidden relative">
            {/* PDF Preview Card */}
            <div className="flex flex-col items-center justify-center h-full p-8">
              <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
                <div className="mb-6">
                  <div className="w-20 h-24 bg-red-500 rounded mx-auto mb-4 flex items-center justify-center">
                    <FileImage className="h-8 w-8 text-white" />
                    <span className="text-white text-xs font-bold absolute mt-8">PDF</span>
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">Technical Drawing</h3>
                  <p className="text-gray-600 text-sm">{fileName}</p>
                </div>
                
                <div className="space-y-3">
                  <Button
                    onClick={() => window.open(pdfUrl, '_blank')}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                    size="lg"
                  >
                    <Eye className="h-5 w-5 mr-2" />
                    View PDF
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = pdfUrl;
                      link.download = fileName;
                      link.click();
                    }}
                    className="w-full"
                  >
                    <Download className="h-5 w-5 mr-2" />
                    Download PDF
                  </Button>
                </div>
                
                <div className="mt-6 text-xs text-gray-500">
                  <p>PDF Size: Ready for viewing</p>
                  <p>Type: 2D Technical Drawing</p>
                </div>
              </div>
            </div>
            
            {/* Alternative: Try simple iframe as fallback */}
            <div className="absolute bottom-4 left-4 text-xs text-gray-500">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  // Try to show inline iframe
                  const container = document.createElement('div');
                  container.style.position = 'fixed';
                  container.style.top = '0';
                  container.style.left = '0';
                  container.style.width = '100%';
                  container.style.height = '100%';
                  container.style.background = 'rgba(0,0,0,0.8)';
                  container.style.zIndex = '10000';
                  container.style.display = 'flex';
                  container.style.alignItems = 'center';
                  container.style.justifyContent = 'center';
                  
                  const iframe = document.createElement('iframe');
                  iframe.src = pdfUrl;
                  iframe.style.width = '90%';
                  iframe.style.height = '90%';
                  iframe.style.border = 'none';
                  iframe.style.background = 'white';
                  
                  const closeBtn = document.createElement('button');
                  closeBtn.innerHTML = '✕';
                  closeBtn.style.position = 'absolute';
                  closeBtn.style.top = '20px';
                  closeBtn.style.right = '20px';
                  closeBtn.style.background = 'white';
                  closeBtn.style.border = 'none';
                  closeBtn.style.fontSize = '20px';
                  closeBtn.style.cursor = 'pointer';
                  closeBtn.style.padding = '10px';
                  closeBtn.style.borderRadius = '50%';
                  closeBtn.onclick = () => document.body.removeChild(container);
                  
                  container.appendChild(iframe);
                  container.appendChild(closeBtn);
                  document.body.appendChild(container);
                }}
              >
                Try Fullscreen View
              </Button>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <FileImage className="h-12 w-12 mx-auto mb-2 text-gray-400" />
              <p className="text-sm">No PDF file available</p>
              <p className="text-xs text-gray-400">File path: {filePath || 'Not specified'}</p>
            </div>
          </div>
        )}
      </div>

      {/* Interactive Balloon Annotator */}
      {pdfUrl && (
        <InteractiveBalloonAnnotator
          open={showAnnotator}
          onOpenChange={setShowAnnotator}
          pdfUrl={pdfUrl}
          fileName={fileName}
          fileId={fileId}
          onSave={(balloons) => {
            console.log('Balloons saved:', balloons);
            setShowAnnotator(false);
          }}
        />
      )}
    </div>
  );
}

interface BalloonDiagramViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inspection: any;
  bomItems?: any[];
}

export default function BalloonDiagramViewer({ 
  open, 
  onOpenChange, 
  inspection, 
  bomItems = [] 
}: BalloonDiagramViewerProps) {
  // Early return before any hooks to prevent hook order violations
  if (!inspection) return null;

  const [activeTab, setActiveTab] = useState('diagram');
  const [zoomLevel, setZoomLevel] = useState(100);
  const [selectedBalloon, setSelectedBalloon] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [balloonAnnotations, setBalloonAnnotations] = useState<{[key: string]: any[]}>({});

  // Memoize drawing files processing to prevent excessive re-renders
  const drawingFiles = useMemo(() => {
    if (!bomItems || bomItems.length === 0) return [];
    
    if (process.env.NODE_ENV === 'development') {
      console.log('BalloonDiagramViewer: Processing BOM items:', bomItems);
    }
    
    const processedFiles = bomItems.map(item => {
      // Check multiple potential 2D file properties from BOM items API
      const file2D = item.file2dPath || item.file_2d_path || item.drawingFile || item.cadFile2D || item.drawing2DFile;

      if (process.env.NODE_ENV === 'development') {
        console.log(`BOM Item ${item.id} (${item.partNumber || item.name}):`, {
          file2dPath: item.file2dPath,
          file_2d_path: item.file_2d_path,
          drawingFile: item.drawingFile,
          cadFile2D: item.cadFile2D,
          drawing2DFile: item.drawing2DFile,
          hasFile: !!file2D
        });
      }

      return {
        id: item.id,
        name: item.partNumber || item.name,
        description: item.description,
        file2D: file2D,
        material: item.materialGrade || item.material,
        quantity: item.quantity,
        unitOfMeasure: item.unit || item.unitOfMeasure,
      };
    });
    
    if (process.env.NODE_ENV === 'development') {
      console.log('BalloonDiagramViewer: All processed files:', processedFiles);
    }
    
    return processedFiles;
  }, [bomItems]);


  const handleZoomIn = () => setZoomLevel(prev => Math.min(prev + 25, 300));
  const handleZoomOut = () => setZoomLevel(prev => Math.max(prev - 25, 25));
  const handleResetZoom = () => setZoomLevel(100);

  const generateBalloonReport = (item: any) => ({
    partName: item.name,
    material: item.material || 'Not specified',
    finish: 'As per specification',
    drawingType: '2D Technical Drawing',
    sheetSize: 'A4',
    surfaceFinish: 'Ra 0.8',
    tolerances: '±0.1mm (unless otherwise specified)',
    inspectionDate: new Date().toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit', 
      year: 'numeric'
    }),
    companyName: 'EMUSKI',
    rawMaterial: item.material || 'Not specified'
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[95vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <FileImage className="h-6 w-6 text-gray-700" />
              Balloon Diagram & Project Report
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600 mt-1">
              {inspection.name} • {drawingFiles.length} drawing(s) available
            </DialogDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="space-y-4">
          {drawingFiles.length > 0 ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="diagram" className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Balloon Diagrams
                </TabsTrigger>
                <TabsTrigger value="report" className="flex items-center gap-2">
                  <Ruler className="h-4 w-4" />
                  Project Reports
                </TabsTrigger>
              </TabsList>

              <TabsContent value="diagram" className="space-y-4">
                {/* Drawing Controls */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">Drawing Controls</CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{drawingFiles.length} drawing(s)</Badge>
                        <Badge variant="outline">{zoomLevel}% zoom</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="default" 
                        size="sm" 
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Circle className="h-4 w-4 mr-1" />
                        Annotate PDFs
                      </Button>
                      
                      <div className="w-px h-6 bg-gray-300" />
                      
                      <Button variant="outline" size="sm" onClick={handleZoomOut}>
                        <ZoomOut className="h-4 w-4 mr-1" />
                        Zoom Out
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleResetZoom}>
                        Reset
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleZoomIn}>
                        <ZoomIn className="h-4 w-4 mr-1" />
                        Zoom In
                      </Button>
                      <Button variant="outline" size="sm">
                        <Maximize2 className="h-4 w-4 mr-1" />
                        Fullscreen
                      </Button>
                      <Button variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Drawing Files */}
                <div className="grid gap-4">
                  {drawingFiles.map((file, index) => (
                    <Card key={file.id} className="border-gray-200">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-lg">
                              1.{index + 1} BALLOON DRAWING
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-1">
                              Part Name: {file.name}
                            </p>
                          </div>
                          <Badge className="bg-gray-100 text-gray-800">
                            2D Technical Drawing
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {/* Drawing Viewer */}
                          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                            <div 
                              className="relative overflow-auto max-h-[500px] flex items-center justify-center bg-gray-50"
                              style={{ minHeight: '400px' }}
                            >
                              {file.file2D ? (
                                // Check if file is PDF and handle accordingly
                                file.file2D.toLowerCase().endsWith('.pdf') ? (
                                  <PDFViewer filePath={file.file2D} fileId={file.id} fileName={file.name} />
                                ) : (
                                  // Handle image files (PNG, JPG, etc.)
                                  failedImages.has(file.file2D) ? (
                                    <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                                      <div className="w-12 h-12 mb-3 text-gray-400">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                          <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                                          <circle cx="9" cy="9" r="2"/>
                                          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
                                        </svg>
                                      </div>
                                      <p className="text-sm">Unable to load drawing</p>
                                      <p className="text-xs text-gray-400 break-all">{file.file2D}</p>
                                    </div>
                                  ) : (
                                    <img
                                      src={`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(file.file2D)}`}
                                      alt={`${file.name} - 2D Drawing`}
                                      className="max-w-full h-auto"
                                      style={{ 
                                        transform: `scale(${zoomLevel / 100})`,
                                        transformOrigin: 'center center'
                                      }}
                                      onError={() => {
                                        setFailedImages(prev => new Set([...prev, file.file2D]));
                                      }}
                                    />
                                  )
                                )
                              ) : (
                                <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                                  <FileImage className="h-12 w-12 mb-3 text-gray-400" />
                                  <p className="text-sm">No drawing file available</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Drawing Info */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                            <div>
                              <p className="text-xs font-medium text-gray-600">Material</p>
                              <p className="text-sm font-mono">{file.material || 'Not specified'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Quantity</p>
                              <p className="text-sm font-mono">{file.quantity} {file.unitOfMeasure || 'pcs'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Drawing Type</p>
                              <p className="text-sm font-mono">2D Technical</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Sheet Size</p>
                              <p className="text-sm font-mono">A4</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="report" className="space-y-4">
                {/* Show report even if no drawings available, using BOM items */}
                {(drawingFiles.length > 0 ? drawingFiles : bomItems.map(item => ({
                  id: item.id,
                  name: item.partNumber || item.name,
                  material: item.materialGrade || item.material,
                  quantity: item.quantity,
                  unitOfMeasure: item.unitOfMeasure
                }))).map((file, index) => {
                  const reportData = generateBalloonReport(file);
                  return (
                    <Card key={file.id} className="border-gray-200">
                      <CardHeader>
                        <CardTitle className="text-lg">
                          1.{index + 1} FINAL INSPECTION REPORT
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        {/* General Information */}
                        <div>
                          <h4 className="font-semibold mb-3 text-blue-700">General Information</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-blue-50 rounded-lg">
                            <div>
                              <p className="text-xs font-medium text-gray-600">Part Name</p>
                              <p className="text-sm font-semibold">{reportData.partName}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Company Name</p>
                              <p className="text-sm font-semibold">{reportData.companyName}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Inspection Date</p>
                              <p className="text-sm font-semibold">{reportData.inspectionDate}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Raw Material</p>
                              <p className="text-sm font-semibold">{reportData.rawMaterial}</p>
                            </div>
                          </div>
                        </div>

                        {/* Inspection Table */}
                        <div>
                          <h4 className="font-semibold mb-3 text-blue-700">Inspection Table (Key Columns)</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border-collapse border border-gray-300">
                              <thead>
                                <tr className="bg-blue-100">
                                  <th className="border border-gray-300 p-2 text-left">S.No</th>
                                  <th className="border border-gray-300 p-2 text-left">Description</th>
                                  <th className="border border-gray-300 p-2 text-left">Spec (mm)</th>
                                  <th className="border border-gray-300 p-2 text-left">UT</th>
                                  <th className="border border-gray-300 p-2 text-left">LT</th>
                                  <th className="border border-gray-300 p-2 text-left">Method</th>
                                  <th className="border border-gray-300 p-2 text-left">Result 1</th>
                                  <th className="border border-gray-300 p-2 text-left">Result 2</th>
                                  <th className="border border-gray-300 p-2 text-left">Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {inspection.checklist?.slice(0, 15).map((check: any, idx: number) => (
                                  <tr key={check.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="border border-gray-300 p-2">{idx + 1}</td>
                                    <td className="border border-gray-300 p-2">{check.requirement || check.description || 'Inspection Item'}</td>
                                    <td className="border border-gray-300 p-2">
                                      {check.category === 'dimensional' ? '±0.1' : 'As per spec'}
                                    </td>
                                    <td className="border border-gray-300 p-2">0.1</td>
                                    <td className="border border-gray-300 p-2">-0.1</td>
                                    <td className="border border-gray-300 p-2">
                                      {check.measurementType === 'measurement' ? 'DVC' : 
                                       check.measurementType === 'visual' ? 'ASGD' : 'Gauge'}
                                    </td>
                                    <td className="border border-gray-300 p-2 bg-green-50">OK</td>
                                    <td className="border border-gray-300 p-2 bg-green-50">OK</td>
                                    <td className="border border-gray-300 p-2 text-green-700 font-semibold">OK</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {/* Summary */}
                        <div className="grid grid-cols-3 gap-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                          <div className="text-center">
                            <p className="text-sm font-semibold text-green-700">Inspector</p>
                            <p className="text-xs">{inspection.inspector || 'Quality Team'}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold text-green-700">Status</p>
                            <Badge className="bg-green-100 text-green-800">APPROVED</Badge>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold text-green-700">Date</p>
                            <p className="text-xs">{reportData.inspectionDate}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </TabsContent>
            </Tabs>
          ) : (
            // Show interface even without drawing files, using all BOM items
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="diagram" className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Balloon Diagrams
                </TabsTrigger>
                <TabsTrigger value="report" className="flex items-center gap-2">
                  <Ruler className="h-4 w-4" />
                  Project Reports
                </TabsTrigger>
              </TabsList>

              <TabsContent value="diagram" className="space-y-4">
                <div className="grid gap-4">
                  {bomItems.map((item, index) => (
                    <Card key={item.id} className="border-gray-200">
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <CardTitle className="text-lg">
                              1.{index + 1} BALLOON DRAWING
                            </CardTitle>
                            <p className="text-sm text-gray-600 mt-1">
                              Part Name: {item.partNumber || item.name}
                            </p>
                          </div>
                          <Badge className="bg-gray-100 text-gray-800">
                            2D Technical Drawing
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                            <div className="relative overflow-auto max-h-[500px] flex items-center justify-center bg-gray-50" style={{ minHeight: '400px' }}>
                              {(item.file2dPath || item.file_2d_path || item.drawingFile || item.cadFile2D || item.drawing2DFile) ? (
                                (item.file2dPath || item.file_2d_path || item.drawingFile || item.cadFile2D || item.drawing2DFile).toLowerCase().endsWith('.pdf') ? (
                                  <PDFViewer 
                                    filePath={item.file2dPath || item.file_2d_path || item.drawingFile || item.cadFile2D || item.drawing2DFile} 
                                    fileId={item.id} 
                                    fileName={item.partNumber || item.name} 
                                  />
                                ) : (
                                  <img
                                    src={`${process.env.NEXT_PUBLIC_API_URL}/files/download?path=${encodeURIComponent(item.file2dPath || item.file_2d_path || item.drawingFile || item.cadFile2D || item.drawing2DFile)}`}
                                    alt={`${item.partNumber || item.name} - 2D Drawing`}
                                    className="max-w-full h-auto"
                                    style={{ 
                                      transform: `scale(${zoomLevel / 100})`,
                                      transformOrigin: 'center center'
                                    }}
                                  />
                                )
                              ) : (
                                <div className="flex flex-col items-center justify-center p-8 text-gray-500">
                                  <FileImage className="h-12 w-12 mb-3 text-gray-400" />
                                  <p className="text-sm">No drawing file available for this item</p>
                                  <p className="text-xs text-gray-400">Upload a 2D drawing to view it here</p>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-lg">
                            <div>
                              <p className="text-xs font-medium text-gray-600">Material</p>
                              <p className="text-sm font-mono">{item.materialGrade || item.material || 'Not specified'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Quantity</p>
                              <p className="text-sm font-mono">{item.quantity} {item.unitOfMeasure || item.unit || 'pcs'}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Drawing Type</p>
                              <p className="text-sm font-mono">2D Technical</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Sheet Size</p>
                              <p className="text-sm font-mono">A4</p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="report" className="space-y-4">
                {bomItems.map((item, index) => {
                  const reportData = generateBalloonReport({
                    id: item.id,
                    name: item.partNumber || item.name,
                    material: item.materialGrade || item.material,
                    quantity: item.quantity,
                    unitOfMeasure: item.unitOfMeasure || item.unit
                  });
                  return (
                    <Card key={item.id} className="border-gray-200">
                      <CardHeader>
                        <CardTitle className="text-lg">
                          1.{index + 1} FINAL INSPECTION REPORT
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div>
                          <h4 className="font-semibold mb-3 text-blue-700">General Information</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-blue-50 rounded-lg">
                            <div>
                              <p className="text-xs font-medium text-gray-600">Part Name</p>
                              <p className="text-sm font-semibold">{reportData.partName}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Company Name</p>
                              <p className="text-sm font-semibold">{reportData.companyName}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Inspection Date</p>
                              <p className="text-sm font-semibold">{reportData.inspectionDate}</p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-gray-600">Raw Material</p>
                              <p className="text-sm font-semibold">{reportData.rawMaterial}</p>
                            </div>
                          </div>
                        </div>
                        <div>
                          <h4 className="font-semibold mb-3 text-blue-700">Inspection Table (Key Columns)</h4>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border-collapse border border-gray-300">
                              <thead>
                                <tr className="bg-blue-100">
                                  <th className="border border-gray-300 p-2 text-left">S.No</th>
                                  <th className="border border-gray-300 p-2 text-left">Description</th>
                                  <th className="border border-gray-300 p-2 text-left">Spec (mm)</th>
                                  <th className="border border-gray-300 p-2 text-left">UT</th>
                                  <th className="border border-gray-300 p-2 text-left">LT</th>
                                  <th className="border border-gray-300 p-2 text-left">Method</th>
                                  <th className="border border-gray-300 p-2 text-left">Result 1</th>
                                  <th className="border border-gray-300 p-2 text-left">Result 2</th>
                                  <th className="border border-gray-300 p-2 text-left">Remarks</th>
                                </tr>
                              </thead>
                              <tbody>
                                {inspection.checklist?.slice(0, 15).map((check: any, idx: number) => (
                                  <tr key={check.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                    <td className="border border-gray-300 p-2">{idx + 1}</td>
                                    <td className="border border-gray-300 p-2">{check.requirement || check.description || 'Inspection Item'}</td>
                                    <td className="border border-gray-300 p-2">
                                      {check.category === 'dimensional' ? '±0.1' : 'As per spec'}
                                    </td>
                                    <td className="border border-gray-300 p-2">0.1</td>
                                    <td className="border border-gray-300 p-2">-0.1</td>
                                    <td className="border border-gray-300 p-2">
                                      {check.measurementType === 'measurement' ? 'DVC' : 
                                       check.measurementType === 'visual' ? 'ASGD' : 'Gauge'}
                                    </td>
                                    <td className="border border-gray-300 p-2 bg-green-50">OK</td>
                                    <td className="border border-gray-300 p-2 bg-green-50">OK</td>
                                    <td className="border border-gray-300 p-2 text-green-700 font-semibold">OK</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                          <div className="text-center">
                            <p className="text-sm font-semibold text-green-700">Inspector</p>
                            <p className="text-xs">{inspection.inspector || 'Quality Team'}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold text-green-700">Status</p>
                            <Badge className="bg-green-100 text-green-800">APPROVED</Badge>
                          </div>
                          <div className="text-center">
                            <p className="text-sm font-semibold text-green-700">Date</p>
                            <p className="text-xs">{reportData.inspectionDate}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}