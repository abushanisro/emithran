'use client';

// Global window type augmentation for balloon persistence
declare global {
  interface Window {
    savedBalloonData?: Record<string, any[]>;
    balloonDataForSave?: Record<string, any[]>;
  }
}



import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
// useBOMItems and useBOMs imported but unused - kept for future use
// import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
// import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useAuth } from '@/lib/providers/auth';
import { useQuery } from '@tanstack/react-query';
import {
  useSaveDetailedInspectionReport,
  useDetailedInspectionReport,
  useUpdateQualityInspection,
  useQualityInspection,
  DetailedInspectionReport
} from '@/lib/api/hooks/useQualityControl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Shield,
  FileText,
  Save,
  Send,
  Download,
  ArrowLeft,
  Edit3,
  Edit,
  Check,
  X,
  CheckCircle,
  Clock,
  XCircle
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';

// Utility function to handle authentication for API requests
const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (process.env.NEXT_PUBLIC_DISABLE_AUTH === 'true') {
    // Development mode with disabled auth - no token needed
    return headers;
  }

  // Production mode - get real Supabase token
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  if (!token) {
    throw new Error('No authentication token available. Please log in again.');
  }

  headers['Authorization'] = `Bearer ${token}`;
  return headers;
};
// InteractiveBalloonAnnotator unused - commented out
// import InteractiveBalloonAnnotator from '@/components/features/quality-control/InteractiveBalloonAnnotator';



// Display Field Component (read-only with edit mode toggle)
interface DisplayFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  isEditing: boolean;
  onChange?: (value: string) => void;
  type?: 'text' | 'date' | 'number';
  className?: string;
}

function DisplayField({
  label,
  value,
  placeholder,
  required = false,
  isEditing,
  onChange,
  type = 'text',
  className = ''
}: DisplayFieldProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </Label>

      {isEditing && onChange ? (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <div className="text-sm py-1">
          {value || <span className="text-muted-foreground italic">{placeholder || 'Not set'}</span>}
        </div>
      )}
    </div>
  );
}

// Display Textarea Component
interface DisplayTextareaProps {
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  isEditing: boolean;
  onChange?: (value: string) => void;
  rows?: number;
  className?: string;
}

function DisplayTextarea({
  label,
  value,
  placeholder,
  required = false,
  isEditing,
  onChange,
  rows = 3,
  className = ''
}: DisplayTextareaProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </Label>

      {isEditing && onChange ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
        />
      ) : (
        <div className="text-sm py-2">
          {value ? (
            <pre className="whitespace-pre-wrap font-sans">{value}</pre>
          ) : (
            <span className="text-muted-foreground italic">{placeholder || 'Not set'}</span>
          )}
        </div>
      )}
    </div>
  );
}

// Table Display Field Component (for table cells)
interface TableDisplayFieldProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  isEditing: boolean;
  className?: string;
}

function TableDisplayField({
  value,
  onChange,
  placeholder,
  type = 'text',
  isEditing,
  className = ''
}: TableDisplayFieldProps) {
  return (
    <>
      {isEditing && onChange ? (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`text-xs ${className}`}
        />
      ) : (
        <div className={`text-xs py-1 ${className}`}>
          {value || <span className="text-muted-foreground italic">{placeholder || 'Not set'}</span>}
        </div>
      )}
    </>
  );
}

// Inline PDF Viewer Component
function InlinePDFViewer({ bomItem, onBalloonsChanged, inspectionId, onSaveToDatabaseSilently, onTableDataExtracted }: { bomItem: any; onBalloonsChanged?: (balloons: any[]) => void; inspectionId: string; onSaveToDatabaseSilently?: () => void; onTableDataExtracted?: (tableData: any) => void }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAnnotationMode, setIsAnnotationMode] = useState(false);
  const [balloons, setBalloons] = useState<Array<{
    id: string,
    number: number,
    x: number,
    y: number
  }>>([]);
  const [selectedBalloon, setSelectedBalloon] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [editingNumber, setEditingNumber] = useState<string | null>(null);
  const [tempNumber, setTempNumber] = useState<number>(0);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isExtractingTable, setIsExtractingTable] = useState(false);

  // Create unique key for this BOM item's balloons
  const balloonStorageKey = `balloons-${inspectionId}-${bomItem.id}`;

  // Extract inspection table data from PDF
  const extractInspectionTableFromPDF = async () => {
    if (!pdfUrl || !onTableDataExtracted) return;

    setIsExtractingTable(true);
    try {
      // Fetch the PDF
      const response = await fetch(pdfUrl);
      const arrayBuffer = await response.arrayBuffer();

      // Get balloon coordinates if they exist
      const savedBalloons = localStorage.getItem(balloonStorageKey);
      const balloonCoordinates = savedBalloons ? JSON.parse(savedBalloons) : [];


      // Send to backend for processing with balloon coordinates
      const extractResponse = await fetch('/api/extract-inspection-table', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pdfBuffer: Array.from(new Uint8Array(arrayBuffer)),
          fileName: bomItem.partNumber || bomItem.name || 'drawing',
          balloonCoordinates: balloonCoordinates.length > 0 ? balloonCoordinates : undefined
        })
      });

      if (!extractResponse.ok) {
        throw new Error('Failed to extract table data from PDF');
      }

      const tableData = await extractResponse.json();

      if (tableData.inspectionRows && tableData.inspectionRows.length > 0) {
        onTableDataExtracted(tableData);

        if (balloonCoordinates.length > 0) {
          const successfulExtractions = tableData.successfulExtractions || tableData.inspectionRows.filter((row: any) => row.nominal && row.nominal !== '').length;
          toast.success(`Extracted ${successfulExtractions}/${balloonCoordinates.length} dimensions from balloon locations!`);
        } else {
          toast.success(`Extracted ${tableData.inspectionRows.length} inspection items from PDF!`);
        }
      } else {
        if (balloonCoordinates.length > 0) {
          toast.warning(`No dimensions found at ${balloonCoordinates.length} balloon locations. Try clicking directly on dimension text.`);
        } else {
          toast.warning('No inspection table data found. Please add balloons to dimension callouts first.');
        }
      }

    } catch (error) {
      toast.error('Failed to extract inspection table from PDF');
    } finally {
      setIsExtractingTable(false);
    }
  };

  const drawingFile = bomItem.file2dPath || bomItem.file_2d_path || bomItem.drawingFile || bomItem.cadFile2D || bomItem.drawing2DFile || bomItem.drawing_2d || bomItem.drawing_file;

  // Handle clicking on the overlay to add balloons
  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isAnnotationMode) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100; // Convert to percentage
    const y = ((event.clientY - rect.top) / rect.height) * 100; // Convert to percentage

    const balloonId = `balloon-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const nextNumber = balloons.length + 1; // Always use next sequential number
    const newBalloon = {
      id: balloonId,
      number: nextNumber,
      x,
      y
    };

    const updatedBalloons = [...balloons, newBalloon];
    setBalloons(updatedBalloons);
    if (onBalloonsChanged) onBalloonsChanged(updatedBalloons);
  };

  // Delete balloon and renumber remaining balloons
  const deleteBalloon = (balloonId: string) => {
    const filtered = balloons.filter(b => b.id !== balloonId);
    // Renumber balloons to maintain sequential order
    const updatedBalloons = filtered.map((balloon, index) => ({
      ...balloon,
      number: index + 1
    }));
    setBalloons(updatedBalloons);
    if (onBalloonsChanged) onBalloonsChanged(updatedBalloons);
    setSelectedBalloon(null);
  };

  // Update balloon position
  const updateBalloonPosition = (balloonId: string, x: number, y: number) => {
    const updatedBalloons = balloons.map(balloon =>
      balloon.id === balloonId ? { ...balloon, x, y } : balloon
    );
    setBalloons(updatedBalloons);
    if (onBalloonsChanged) onBalloonsChanged(updatedBalloons);
  };

  // Update balloon number
  const updateBalloonNumber = (balloonId: string, newNumber: number) => {
    // Check if number already exists
    const existingBalloon = balloons.find(b => b.number === newNumber && b.id !== balloonId);
    if (existingBalloon) {
      toast.error(`Number ${newNumber} already exists`);
      return false;
    }

    const updatedBalloons = balloons.map(balloon =>
      balloon.id === balloonId ? { ...balloon, number: newNumber } : balloon
    );
    setBalloons(updatedBalloons);
    if (onBalloonsChanged) onBalloonsChanged(updatedBalloons);
    return true;
  };

  // Handle mouse events for dragging
  const handleMouseDown = (e: React.MouseEvent, balloonId: string) => {
    if (!isAnnotationMode) return;

    e.stopPropagation();
    setSelectedBalloon(balloonId);
    setIsDragging(true);

    const balloon = balloons.find(b => b.id === balloonId);
    if (!balloon) return;

    const containerRect = (e.currentTarget.closest('[data-pdf-container]') as HTMLElement)?.getBoundingClientRect();
    if (!containerRect) return;

    const balloonX = (balloon.x / 100) * containerRect.width;
    const balloonY = (balloon.y / 100) * containerRect.height;

    setDragOffset({
      x: e.clientX - (containerRect.left + balloonX),
      y: e.clientY - (containerRect.top + balloonY)
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selectedBalloon || !isAnnotationMode) return;

    const containerRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = ((e.clientX - dragOffset.x - containerRect.left) / containerRect.width) * 100;
    const y = ((e.clientY - dragOffset.y - containerRect.top) / containerRect.height) * 100;

    // Constrain to container bounds
    const constrainedX = Math.max(2, Math.min(98, x));
    const constrainedY = Math.max(2, Math.min(98, y));

    updateBalloonPosition(selectedBalloon, constrainedX, constrainedY);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragOffset({ x: 0, y: 0 });
  };

  // Handle double-click to edit number
  const handleDoubleClick = (e: React.MouseEvent, balloonId: string) => {
    if (!isAnnotationMode) return;

    e.stopPropagation();
    const balloon = balloons.find(b => b.id === balloonId);
    if (balloon) {
      setEditingNumber(balloonId);
      setTempNumber(balloon.number);
    }
  };

  // Save edited number
  const saveEditedNumber = () => {
    if (editingNumber && tempNumber > 0) {
      if (updateBalloonNumber(editingNumber, tempNumber)) {
        setEditingNumber(null);
        toast.success(`Updated balloon number to ${tempNumber}`);
      }
    } else {
      setEditingNumber(null);
    }
  };

  // Cancel editing
  const cancelEditNumber = () => {
    setEditingNumber(null);
    setTempNumber(0);
  };

  // Toggle annotation mode
  const toggleAnnotationMode = () => {
    setIsAnnotationMode(!isAnnotationMode);
    if (isAnnotationMode) {
      // Save balloons when exiting annotation mode
      localStorage.setItem(balloonStorageKey, JSON.stringify(balloons));
      toast.success(`Saved ${balloons.length} balloon annotations`);
      setSelectedBalloon(null); // Clear selection when exiting
    }
  };

  // Download PDF with balloons as proper PDF file
  const downloadPDFWithBalloons = async () => {
    if (!pdfUrl) {
      toast.error('No PDF URL available');
      return;
    }

    if (balloons.length === 0) {
      // If no balloons, just download original PDF
      window.open(pdfUrl, '_blank');
      return;
    }

    setIsGeneratingPDF(true);
    try {
      // Import required libraries
      const { PDFDocument, rgb } = await import('pdf-lib');

      // Fetch the original PDF
      const response = await fetch(pdfUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch original PDF');
      }

      const existingPdfBytes = await response.arrayBuffer();
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      // Get the first page (assuming single page for now)
      const pages = pdfDoc.getPages();
      if (pages.length === 0) {
        throw new Error('PDF has no pages');
      }

      const firstPage = pages[0];
      if (!firstPage) throw new Error('PDF has no pages');
      const { width, height } = firstPage.getSize();


      // Get the PDF container element that holds the iframe
      const pdfContainer = document.querySelector('[data-pdf-container]') as HTMLElement;
      const iframeElement = document.querySelector('iframe[title="2D Technical Drawing"]') as HTMLIFrameElement;
      
      if (!pdfContainer) {
        throw new Error('PDF container not found');
      }

      // Calculate the actual PDF display dimensions considering the PDF viewer's scaling
      const containerRect = pdfContainer.getBoundingClientRect();
      
      // Account for PDF viewer's internal scaling due to view=Fit&zoom=page-fit
      // The PDF viewer scales the content to fit the container, so we need to 
      // calculate the actual displayed PDF dimensions within the iframe
      const containerAspectRatio = containerRect.width / containerRect.height;
      const pdfAspectRatio = width / height;
      
      let displayedPDFWidth, displayedPDFHeight;
      
      if (containerAspectRatio > pdfAspectRatio) {
        // Container is wider than PDF - PDF fits to height
        displayedPDFHeight = containerRect.height;
        displayedPDFWidth = displayedPDFHeight * pdfAspectRatio;
      } else {
        // Container is taller than PDF - PDF fits to width
        displayedPDFWidth = containerRect.width;
        displayedPDFHeight = displayedPDFWidth / pdfAspectRatio;
      }
      
      // Calculate the offset if PDF is centered in container
      const offsetX = (containerRect.width - displayedPDFWidth) / 2;
      const offsetY = (containerRect.height - displayedPDFHeight) / 2;

      // Draw balloons on the PDF with exact screen alignment
      balloons.forEach(balloon => {
        // Convert balloon percentage coordinates to actual PDF coordinates
        // Account for the displayed PDF size and centering offset
        const relativeX = (balloon.x / 100) * containerRect.width - offsetX;
        const relativeY = (balloon.y / 100) * containerRect.height - offsetY;
        
        // Scale to actual PDF coordinates
        const pdfX = (relativeX / displayedPDFWidth) * width;
        const pdfY = height - ((relativeY / displayedPDFHeight) * height); // PDF coordinates are bottom-up


        // Draw balloon circle with exact positioning
        firstPage.drawCircle({
          x: pdfX,
          y: pdfY,
          size: 8, // Radius to match screen
          color: rgb(0.937, 0.267, 0.267), // Red color (#EF4444)
          borderColor: rgb(0.725, 0.110, 0.110), // Dark red border (#B91C1C)
          borderWidth: 1,
        });

        // Draw balloon number with exact centering
        const numberText = balloon.number.toString();
        firstPage.drawText(numberText, {
          x: pdfX - (numberText.length > 1 ? 3 : 1.5), // Center the text
          y: pdfY - 2.5, // Center vertically in circle
          size: 6, // Font size to match screen
          color: rgb(1, 1, 1), // White text
        });
      });

      // Add annotation metadata
      pdfDoc.setTitle(`${bomItem.partNumber || bomItem.name || 'Drawing'} - Balloon Annotated`);
      pdfDoc.setSubject('Technical Drawing with Balloon Annotations');
      pdfDoc.setCreator('Mithran Quality Control System');
      pdfDoc.setProducer('PDF-lib');
      pdfDoc.setCreationDate(new Date());
      pdfDoc.setModificationDate(new Date());

      // Save the PDF
      const pdfBytes = await pdfDoc.save();

      // Create download
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bomItem.partNumber || bomItem.name || 'drawing'}-with-balloons.pdf`;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Downloaded PDF with ${balloons.length} balloon annotations`);

    } catch (error) {
      toast.error('Failed to generate PDF with balloons. Downloading original PDF instead.');
      // Fallback to original PDF
      window.open(pdfUrl, '_blank');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  // Load balloons from localStorage on mount
  useEffect(() => {
    if (drawingFile && bomItem.id) {
      loadPDF();
      loadBalloonsFromStorage();
    }
  }, [drawingFile, bomItem.id]);

  // Load balloons from localStorage
  const loadBalloonsFromStorage = () => {
    try {
      const savedBalloons = localStorage.getItem(balloonStorageKey);
      if (savedBalloons) {
        const parsed = JSON.parse(savedBalloons);
        setBalloons(parsed);
      }

      // Also check global saved data
      if (window.savedBalloonData && window.savedBalloonData[bomItem.id]) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        setBalloons(window.savedBalloonData[bomItem.id]!);
      }
    } catch (error) {
      // Error loading balloons from storage
    }
  };

  // Save balloons to localStorage and database whenever they change
  useEffect(() => {
    if (balloons.length > 0 || localStorage.getItem(balloonStorageKey)) {
      localStorage.setItem(balloonStorageKey, JSON.stringify(balloons));

      // Also save to global object for main persistence
      if (!window.balloonDataForSave) window.balloonDataForSave = {};
      window.balloonDataForSave[bomItem.id] = balloons;

    }

    // Auto-save balloons to database when they change (debounced)
    // Always set up timer cleanup regardless of balloon count
    if (balloons.length > 0 && onSaveToDatabaseSilently) {
      const timer = setTimeout(() => {
        onSaveToDatabaseSilently();
      }, 2000); // Wait 2 seconds after balloon changes stop

      return () => clearTimeout(timer);
    }

    return undefined;
  }, [balloons, balloonStorageKey, bomItem.id]);

  const loadPDF = async () => {
    if (!drawingFile) return;

    setLoading(true);
    setError(null);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bom-items/${bomItem.id}/file-url/2d`, {
        headers,
      });

      if (response.ok) {
        const data = await response.json();

        // Try different possible response formats
        const signedUrl = data.url || data.signedUrl || data.downloadUrl || data.fileUrl || data.data?.url;

        if (signedUrl) {
          // ⚡ CRITICAL: Never embed the Supabase signed URL directly in an iframe.
          // Chrome blocks cross-site iframes (sec-fetch-site: cross-site + sec-fetch-dest: iframe).
          // Route through the same-origin proxy so the iframe src is localhost:3000.
          const proxyUrl = `/api/file-proxy?url=${encodeURIComponent(signedUrl)}`;
          setPdfUrl(proxyUrl);
        } else {
          throw new Error(`No URL returned from server. Response: ${JSON.stringify(data)}`);
        }
      } else {
        const errorText = await response.text();
        throw new Error(`Failed to get PDF URL: ${response.status} - ${errorText}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PDF');
    } finally {
      setLoading(false);
    }
  };

  if (!drawingFile) {
    return (
      <div className="space-y-2">
        <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg">
          <FileText className="h-12 w-12 mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No 2D drawing file found for this item</p>
          <p className="text-xs text-muted-foreground mt-1">
            Looked for: file2dPath, file_2d_path, drawingFile, cadFile2D, drawing2DFile
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* PDF viewer — no padding, edge-to-edge */}
      <div className="w-full overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-8 bg-muted/30 rounded-lg">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">Loading 2D Drawing...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center p-8 bg-muted/30 rounded-lg">
            <FileText className="h-12 w-12 mb-3 text-muted-foreground" />
            <p className="text-sm text-red-500 mb-2">Failed to load PDF</p>
            <p className="text-xs text-muted-foreground mb-3">{error}</p>
            <Button onClick={loadPDF} variant="outline" size="sm">Try Again</Button>
          </div>
        ) : pdfUrl ? (
          <div>
            {/* Responsive toolbar — stacks vertically on small screens */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-2 px-3 py-2 bg-muted border-b">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">
                  {bomItem.partNumber || bomItem.name} — 2D Drawing
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  onClick={toggleAnnotationMode}
                  variant={isAnnotationMode ? 'destructive' : 'default'}
                  size="sm"
                  className={isAnnotationMode ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
                >
                  <Edit3 className="h-4 w-4 lg:mr-1" />
                  <span className="hidden lg:inline">
                    {isAnnotationMode ? 'Save Balloons' : 'Add Balloons'}
                  </span>
                </Button>
                {isAnnotationMode && balloons.length > 0 && (
                  <Button
                    onClick={() => { setBalloons([]); setSelectedBalloon(null); }}
                    variant="outline"
                    size="sm"
                  >
                    Clear All
                  </Button>
                )}
                {isAnnotationMode && (
                  <span className="hidden xl:inline text-xs text-red-600 font-medium">
                    {isDragging ? 'Dragging…' : 'Click to add • Drag to move'}
                  </span>
                )}
                <Button
                  onClick={() => window.open(pdfUrl, '_blank')}
                  variant="outline"
                  size="sm"
                  title="Open Full Size"
                >
                  <Download className="h-4 w-4 lg:mr-1" />
                  <span className="hidden lg:inline">Open Full Size</span>
                </Button>
                <Button
                  onClick={downloadPDFWithBalloons}
                  variant="outline"
                  size="sm"
                  disabled={isGeneratingPDF}
                  title={balloons.length > 0 ? 'Download with Balloons' : 'Download PDF'}
                >
                  {isGeneratingPDF ? (
                    <div className="animate-spin h-4 w-4 lg:mr-1">⟳</div>
                  ) : (
                    <Download className="h-4 w-4 lg:mr-1" />
                  )}
                  <span className="hidden lg:inline">
                    {balloons.length > 0 ? 'Download with Balloons' : 'Download PDF'}
                  </span>
                </Button>
                <Button
                  onClick={extractInspectionTableFromPDF}
                  variant="default"
                  size="sm"
                  disabled={!pdfUrl || isExtractingTable}
                  className="bg-green-600 hover:bg-green-700"
                  title="Extract Table Data"
                >
                  {isExtractingTable ? (
                    <div className="animate-spin h-4 w-4 lg:mr-1">⟳</div>
                  ) : (
                    <Download className="h-4 w-4 lg:mr-1" />
                  )}
                  <span className="hidden lg:inline">Extract Table Data</span>
                </Button>
              </div>
            </div>


            {/* PDF + balloon overlay — full width, no padding */}
            <div
              className={`w-full relative ${isAnnotationMode ? 'cursor-crosshair' : ''} h-[50vh] lg:h-[85vh]`}
              onClick={isAnnotationMode ? handleOverlayClick : undefined}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              data-pdf-container
            >
              {/* PDF iframe — src is always the same-origin proxy, never a raw Supabase URL */}
              <iframe
                src={`${pdfUrl}#view=Fit&zoom=page-fit&scrollbar=0&toolbar=0&navpanes=0&statusbar=0&messages=0&page=1`}
                title="2D Technical Drawing"
                className="absolute inset-0 w-full h-full border-0"
                style={{
                  pointerEvents: isAnnotationMode ? 'none' :
                    balloons.length > 0 && !isAnnotationMode ? 'none' : 'auto',
                  overflow: 'hidden',
                  border: 'none',
                  margin: '0',
                  padding: '0'
                }}
                scrolling="no"
                frameBorder="0"
                marginHeight="0"
                marginWidth="0"
              />

              {/* Balloon Overlays */}
              {(isAnnotationMode || balloons.length > 0) && (
                <>
                  {balloons.map((balloon) => (
                    <div
                      key={balloon.id}
                      className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all select-none ${isAnnotationMode
                        ? (isDragging && selectedBalloon === balloon.id ? 'cursor-grabbing' : 'cursor-grab')
                        : 'cursor-default'
                        } ${selectedBalloon === balloon.id && isAnnotationMode ? 'ring-4 ring-blue-500 ring-opacity-50' : ''
                        } ${isDragging && selectedBalloon === balloon.id ? 'z-50 scale-110' : ''
                        }`}
                      style={{ left: `${balloon.x}%`, top: `${balloon.y}%`, zIndex: 10 }}
                      onMouseDown={(e) => handleMouseDown(e, balloon.id)}
                      onDoubleClick={(e) => handleDoubleClick(e, balloon.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isAnnotationMode && !isDragging) setSelectedBalloon(balloon.id);
                      }}
                    >
                      <div className="relative">
                        <div
                          className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold shadow-lg transition-all ${selectedBalloon === balloon.id && isAnnotationMode
                            ? 'bg-red-600 border-red-700 text-white scale-110'
                            : `bg-red-500 border-red-700 text-white ${isAnnotationMode ? 'hover:bg-red-600' : ''}`
                            } ${isDragging && selectedBalloon === balloon.id ? 'shadow-2xl' : ''
                            }`}
                        >
                          {editingNumber === balloon.id ? (
                            <input
                              type="number"
                              value={tempNumber}
                              onChange={(e) => setTempNumber(parseInt(e.target.value) || 0)}
                              onBlur={saveEditedNumber}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEditedNumber();
                                if (e.key === 'Escape') cancelEditNumber();
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="w-6 h-6 text-xs text-center bg-transparent text-white border-0 outline-0 appearance-none"
                              min="1" max="99"
                            />
                          ) : balloon.number}
                        </div>
                        {selectedBalloon === balloon.id && isAnnotationMode && (
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteBalloon(balloon.id); }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs hover:bg-gray-900"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {balloons.length === 0 && isAnnotationMode && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/10" style={{ zIndex: 5 }}>
                      <div className="bg-white/90 rounded-lg p-4 text-center border border-red-200 shadow-lg">
                        <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-2">
                          <span className="text-white font-bold text-sm">1</span>
                        </div>
                        <p className="text-sm font-semibold text-gray-800">Click anywhere to place balloon #1</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}


export default function QualityInspectionPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const inspectionId = params.inspectionId as string;

  // Debug auth state
  const { user } = useAuth();

  // Fetch BOMs for the project - bypass readiness check temporarily
  const bomsQuery = useQuery({
    queryKey: ['bom', 'list', { projectId }],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      const queryString = params.toString();

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/boms${queryString ? `?${queryString}` : ''}`, {
        headers,
      });

      if (!response.ok) throw new Error(`Failed to fetch BOMs: ${response.status}`);
      return await response.json();
    },
    enabled: !!user && !!projectId,
    staleTime: 1000 * 60 * 5,
  });
  const { data: bomsData, isLoading: bomsLoading, error: bomsError } = bomsQuery;

  // Get the first BOM for this project (or the most recent one)
  const projectBOM = bomsData?.data?.boms?.[0] || bomsData?.boms?.[0] || bomsData?.data?.[0] || bomsData?.[0];


  // Mock inspection data - replace with actual API call
  const inspection = {
    id: inspectionId,
    name: 'quality report emuski',
    bomId: projectBOM?.id,
    selectedItems: []
  };

  // Fetch BOM items for the inspection - bypass readiness check temporarily

  const bomItemsQuery = useQuery({
    queryKey: ['bom-items', 'list', inspection?.bomId],
    queryFn: async () => {
      if (!inspection?.bomId) return { items: [] };

      const headers = await getAuthHeaders();
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bom-items?bomId=${inspection.bomId}`, {
        headers,
      });

      if (!response.ok) throw new Error(`Failed to fetch BOM items: ${response.status}`);
      return await response.json();
    },
    enabled: !!user && !!inspection?.bomId,
    staleTime: 1000 * 60 * 2,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const { data: bomItemsData, isLoading: bomItemsLoading, error: bomItemsError } = bomItemsQuery;


  // Get BOM items for inspection
  const getBOMItemsForInspection = () => {
    if (bomItemsLoading) {
      return [];
    }

    if (bomItemsError) {
      return [];
    }

    // Extract items from the API response structure
    const items = bomItemsData?.data?.items || bomItemsData?.items || [];

    if (!items || items.length === 0) {
      return [];
    }


    // Return all items for this project's BOM for now
    // TODO: Filter based on actual inspection selection
    return items;
  };

  const bomItems = getBOMItemsForInspection();


  // Database hooks for saving/loading inspection reports
  const saveInspectionReport = useSaveDetailedInspectionReport();
  const updateInspection = useUpdateQualityInspection();
  // Load existing report - now properly handles 404 errors
  const { data: existingReport, isLoading: reportLoading } = useDetailedInspectionReport(inspectionId);
  // Load current inspection data to check status
  const { data: currentInspection, isLoading: inspectionLoading } = useQualityInspection(inspectionId);

  // Edit mode states for each section
  const [balloonDrawingEditMode, setBalloonDrawingEditMode] = useState(false);
  const [finalInspectionEditMode, setFinalInspectionEditMode] = useState(false);
  const [inspectionTableEditMode, setInspectionTableEditMode] = useState(false);

  // 1.3 BALLOON DRAWING fields
  const [partName, setPartName] = useState('');
  const [material, setMaterial] = useState('');
  const [surfaceTreatment, setSurfaceTreatment] = useState('');
  const [drawingTitle, setDrawingTitle] = useState('');
  const [drawingSize, setDrawingSize] = useState('A4');

  // Balloon annotations state
  const [balloons, setBalloons] = useState<Array<{
    id: string,
    number: number,
    x: number,
    y: number
  }>>([]);

  // 1.4 FINAL INSPECTION REPORT fields
  const [companyName, setCompanyName] = useState('EMUSKI');
  const [revisionNumber, setRevisionNumber] = useState('—');
  const [inspectionDate, setInspectionDate] = useState<string>(new Date().toISOString().split('T')[0] ?? '');
  const [rawMaterial, setRawMaterial] = useState('');
  const [inspectionBy, setInspectionBy] = useState('');
  const [approvedBy, setApprovedBy] = useState('');

  // Configurable sample count
  const [sampleCount, setSampleCount] = useState(5);

  // Inspection table data with dynamic samples - persisted
  const [inspectionRows, setInspectionRows] = useState<any[]>([]);

  const [generalRemarks, setGeneralRemarks] = useState('');
  const [status, setStatus] = useState('release');
  const [lastSavedTime, setLastSavedTime] = useState<string>('');


  // Persistence key for this specific inspection
  const persistenceKey = `qc-inspection-${inspectionId}`;

  // Load persisted data on mount
  useEffect(() => {
    try {
      const savedData = localStorage.getItem(persistenceKey);
      if (savedData) {
        const parsed = JSON.parse(savedData);

        // Restore inspection data
        if (parsed.inspectionRows && parsed.inspectionRows.length > 0) {
          setInspectionRows(parsed.inspectionRows);
        }
        if (parsed.generalRemarks) {
          setGeneralRemarks(parsed.generalRemarks);
        }
        // Status is now managed by database only - do not load from localStorage
        // if (parsed.status) {
        //   // Convert legacy uppercase status values to lowercase for backend compatibility
        //   const normalizedStatus = parsed.status.toLowerCase();
        //   setStatus(normalizedStatus);
        // }
        if (parsed.sampleCount) {
          setSampleCount(parsed.sampleCount);
        }

        // Restore form data
        if (parsed.partName) setPartName(parsed.partName);
        if (parsed.material) setMaterial(parsed.material);
        if (parsed.surfaceTreatment) setSurfaceTreatment(parsed.surfaceTreatment);
        if (parsed.drawingTitle) setDrawingTitle(parsed.drawingTitle);
        if (parsed.drawingSize) setDrawingSize(parsed.drawingSize);
        if (parsed.companyName) setCompanyName(parsed.companyName);
        if (parsed.revisionNumber) setRevisionNumber(parsed.revisionNumber);
        if (parsed.inspectionDate) setInspectionDate(parsed.inspectionDate);
        if (parsed.rawMaterial) setRawMaterial(parsed.rawMaterial);
        if (parsed.inspectionBy) setInspectionBy(parsed.inspectionBy);
        if (parsed.approvedBy) setApprovedBy(parsed.approvedBy);

        // Restore balloon data for each BOM item
        if (parsed.balloonData) {
          // We'll restore balloons when BOM items are loaded
          window.savedBalloonData = parsed.balloonData;
        }

      }
    } catch (error) {
      // Error loading persisted inspection data
    }
  }, [inspectionId]);

  // Save data to localStorage whenever it changes
  useEffect(() => {
    const dataToSave = {
      inspectionRows,
      generalRemarks,
      // status removed - database is source of truth for status
      sampleCount,
      partName,
      material,
      surfaceTreatment,
      drawingTitle,
      drawingSize,
      companyName,
      revisionNumber,
      inspectionDate,
      rawMaterial,
      inspectionBy,
      approvedBy,
      balloonData: window.balloonDataForSave || {},
      lastUpdated: new Date().toISOString()
    };

    try {
      localStorage.setItem(persistenceKey, JSON.stringify(dataToSave));
    } catch (error) {
      // Error saving inspection data to localStorage
    }
  }, [
    inspectionRows, generalRemarks, /* status removed - database source of truth */ sampleCount,
    partName, material, surfaceTreatment, drawingTitle, drawingSize,
    companyName, revisionNumber, inspectionDate, rawMaterial, inspectionBy, approvedBy,
    persistenceKey
  ]);

  // Auto-populate fields when BOM items are available
  useEffect(() => {
    if (bomItems.length > 0 && !partName) {
      const firstItem = bomItems[0];
      setPartName(firstItem.partNumber || firstItem.name || '');
      setMaterial(firstItem.materialGrade || firstItem.material || '');
      setRawMaterial(firstItem.materialGrade || firstItem.material || '');
      setDrawingTitle((firstItem.partNumber || firstItem.name || '').toUpperCase());
    }
  }, [bomItems, partName]);

  // Load existing report data from database when available (handle 404 gracefully)
  useEffect(() => {

    // Only load if we actually have report data (not null/404 error)
    if (existingReport && !reportLoading && existingReport !== null && typeof existingReport === 'object' && existingReport.inspectionId) {

      try {
        // Load balloon drawing data
        const { balloonDrawing } = existingReport;
        if (balloonDrawing) {
          setPartName(balloonDrawing.partName || '');
          setMaterial(balloonDrawing.material || '');
          setSurfaceTreatment(balloonDrawing.surfaceTreatment || '');
          setDrawingTitle(balloonDrawing.drawingTitle || '');
          setDrawingSize(balloonDrawing.drawingSize || 'A4');

          // Load balloon annotations - this is the key fix for balloon persistence
          if (balloonDrawing.balloonAnnotations && balloonDrawing.balloonAnnotations.length > 0) {
            setBalloons(balloonDrawing.balloonAnnotations);
          }
        }

        // Load final inspection report data
        const { finalInspectionReport } = existingReport;
        if (finalInspectionReport) {
          const todayStr: string = new Date().toISOString().slice(0, 10);
          setCompanyName(finalInspectionReport.companyName || 'EMUSKI');
          setRevisionNumber(finalInspectionReport.revisionNumber || '—');
          setInspectionDate(finalInspectionReport.inspectionDate || todayStr);
          setRawMaterial(finalInspectionReport.rawMaterial || '');
          setInspectionBy(finalInspectionReport.inspectionBy || '');
          setApprovedBy(finalInspectionReport.approvedBy || '');
          setGeneralRemarks(finalInspectionReport.generalRemarks || '');
          // Always use database status as source of truth
          const dbStatus = finalInspectionReport.status || 'draft';
          setStatus(dbStatus);
        }

        // Load inspection table data
        const { inspectionTable } = existingReport;
        if (inspectionTable && inspectionTable.measurements) {
          setSampleCount(inspectionTable.samples || 5);
          setInspectionRows(inspectionTable.measurements.map(m => ({
            id: m.id,
            specification: m.specification || '',
            nominal: m.nominal?.toString() || '',
            plusTol: m.plusTolerance?.toString() || '',
            minusTol: m.minusTolerance?.toString() || '',
            method: m.method || '',
            samples: Array.isArray(m.sampleValues) ? m.sampleValues.map(v => v?.toString() || '') : Array(5).fill(''),
            remarks: m.remarks || ''
          })));
        }
      } catch (error) {
        toast.error('Failed to load existing report data');
      }
    } else if (existingReport === null && !reportLoading) {
      // Initialize with default row if no existing report
      if (inspectionRows.length === 0) {
        setInspectionRows([
          {
            id: 'row-1',
            specification: '',
            nominal: '',
            plusTol: '',
            minusTol: '',
            method: '',
            samples: Array(5).fill(''),
            remarks: ''
          }
        ]);
      }
    }
  }, [existingReport, reportLoading]);

  // Update sample count and adjust existing rows
  const updateSampleCount = (newCount: number) => {
    // Limit to maximum of 5 samples
    const limitedCount = Math.min(Math.max(newCount, 1), 5);
    setSampleCount(limitedCount);
    setInspectionRows(inspectionRows.map(row => ({
      ...row,
      samples: Array(limitedCount).fill('').map((_, i) => row.samples[i] || '')
    })));
  };

  const addInspectionRow = () => {
    // Create a consistent string ID
    const maxNumericId = inspectionRows.length > 0
      ? Math.max(...inspectionRows.map(row => {
        if (typeof row.id === 'string' && row.id.includes('row-')) {
          return parseInt(row.id.replace('row-', ''), 10) || 0;
        } else if (typeof row.id === 'number') {
          return row.id;
        }
        return 0;
      }))
      : 0;

    const newRow = {
      id: `row-${maxNumericId + 1}`, // Always create string IDs
      specification: '',
      nominal: '',
      plusTol: '',
      minusTol: '',
      method: '',
      samples: Array(sampleCount).fill(''),
      remarks: ''
    };
    setInspectionRows([...inspectionRows, newRow]);
  };

  const updateInspectionRow = (id: string | number, field: string, value: string, sampleIndex?: number) => {
    setInspectionRows(inspectionRows.map(row => {
      if (row.id === id) {
        if (field === 'sample' && sampleIndex !== undefined) {
          const newSamples = [...row.samples];
          newSamples[sampleIndex] = value;
          return { ...row, samples: newSamples };
        }
        return { ...row, [field]: value };
      }
      return row;
    }));
  };

  const removeInspectionRow = (id: string | number) => {
    setInspectionRows(inspectionRows.filter(row => row.id !== id));
  };

  // Validation function
  const validateRequiredFields = () => {
    const errors: string[] = [];

    if (!partName.trim()) errors.push('Part Name is required');
    if (!material.trim()) errors.push('Material is required');
    if (!inspectionBy.trim()) errors.push('Inspector name is required');
    if (!rawMaterial.trim()) errors.push('Raw Material is required');

    if (errors.length > 0) {
      toast.error(`Please fill required fields: ${errors.join(', ')}`);
      return false;
    }

    return true;
  };

  // Silent database save for auto-saving balloons
  const saveToDatabaseSilently = async () => {
    // Only auto-save if we have basic data filled in
    if (!partName || !material || !drawingTitle) {
      return;
    }

    const reportData: DetailedInspectionReport = {
      inspectionId,
      balloonDrawing: {
        partName,
        material,
        surfaceTreatment: surfaceTreatment || undefined,
        drawingTitle,
        drawingSize,
        balloonAnnotations: balloons
      },
      finalInspectionReport: {
        companyName: companyName || 'Auto-saved',
        revisionNumber: revisionNumber || undefined,
        inspectionDate: inspectionDate || new Date().toISOString().slice(0, 10),
        rawMaterial: rawMaterial || material,
        inspectionBy: inspectionBy || 'Auto-saved',
        approvedBy: approvedBy || undefined,
        generalRemarks: generalRemarks || undefined,
        status: 'draft'
      },
      inspectionTable: {
        samples: sampleCount,
        measurements: inspectionRows.map((row, index) => ({
          id: row.id?.toString() || `row-${index + 1}`,
          slNo: typeof row.id === 'string' && row.id.includes('row-')
            ? parseInt(row.id.replace('row-', ''), 10) || (index + 1)
            : typeof row.id === 'number' ? row.id : (index + 1),
          specification: row.specification || '',
          nominal: parseFloat(row.nominal) || 0,
          plusTolerance: parseFloat(row.plusTol) || 0,
          minusTolerance: parseFloat(row.minusTol) || 0,
          method: row.method || '',
          sampleValues: row.samples ? row.samples.map((s: string) => parseFloat(s) || 0) : Array(sampleCount).fill(0),
          remarks: row.remarks || ''
        }))
      }
    };

    try {
      await saveInspectionReport.mutateAsync(reportData);
    } catch (error) {
      // Auto-save failed silently
    }
  };

  // Complete the inspection
  const handleCompleteInspection = async () => {
    try {
      const updateData = {
        id: inspectionId,
        data: {
          checklist: [{ key: 'status', value: 'completed' }] as any[],
          quality_standards: { status: 'completed', notes: generalRemarks } as any
        }
      };
      await updateInspection.mutateAsync(updateData);
      toast.success('Inspection report submitted and completed successfully! You can now approve or reject it.');
      router.push(`/projects/${projectId}/quality-control`);
    } catch (error) {
      toast.error('Failed to complete inspection');
    }
  };

  // Save inspection report to database
  const handleSaveReport = async (isDraft = true, silent = false) => {
    // Validate required fields for final submission
    if (!isDraft && !validateRequiredFields()) {
      return;
    }

    // Validate and normalize status before saving
    const validStatuses = ['draft', 'release', 'rejected'];
    let finalStatus = isDraft ? 'draft' : status.toLowerCase();


    // Ensure status is one of the allowed values
    if (!validStatuses.includes(finalStatus)) {
      finalStatus = 'draft'; // Default to draft for invalid values
    }

    const reportData: DetailedInspectionReport = {
      inspectionId,
      balloonDrawing: {
        partName,
        material,
        surfaceTreatment: surfaceTreatment || undefined,
        drawingTitle,
        drawingSize,
        balloonAnnotations: balloons
      },
      finalInspectionReport: {
        companyName,
        revisionNumber: revisionNumber || undefined,
        inspectionDate: inspectionDate || new Date().toISOString().slice(0, 10),
        rawMaterial: rawMaterial || '',
        inspectionBy: inspectionBy || '',
        approvedBy: approvedBy || undefined,
        generalRemarks: generalRemarks || undefined,
        status: finalStatus as 'draft' | 'release' | 'rejected'
      },
      inspectionTable: {
        samples: sampleCount,
        measurements: inspectionRows.map((row, index) => ({
          id: row.id?.toString() || `row-${index + 1}`,
          slNo: typeof row.id === 'string' && row.id.includes('row-')
            ? parseInt(row.id.replace('row-', ''), 10) || (index + 1)
            : typeof row.id === 'number' ? row.id : (index + 1),
          specification: row.specification || '',
          nominal: parseFloat(row.nominal) || 0,
          plusTolerance: parseFloat(row.plusTol) || 0,
          minusTolerance: parseFloat(row.minusTol) || 0,
          method: row.method || '',
          sampleValues: row.samples ? row.samples.map((s: string) => parseFloat(s) || 0) : Array(sampleCount).fill(0),
          remarks: row.remarks || undefined
        }))
      }
    };

    try {
      const savedReport = await saveInspectionReport.mutateAsync(reportData);

      // Update local status from the database response (not local state)
      if (savedReport?.finalInspectionReport?.status) {
        const newStatus = savedReport.finalInspectionReport.status;
        setStatus(newStatus);

        // Update timestamp
        const now = new Date().toLocaleString();
        setLastSavedTime(now);


        // Force a re-render by updating a state that affects UI
        if (!silent) {
          toast.success(`Inspection report ${isDraft ? 'saved as draft' : 'submitted'} successfully! Status: ${newStatus.toUpperCase()}`);
        }
      } else {
        if (!silent) {
          toast.success(`Inspection report ${isDraft ? 'saved as draft' : 'submitted'} successfully!`);
        }
      }
    } catch (error) {
      toast.error(`Failed to ${isDraft ? 'save draft' : 'submit'} inspection report`);
    }
  };

  // Generate formatted output
  const generateFormattedOutput = () => {
    let output = "Inspection Table (Summary)\n\n";

    // Header
    const headers = ["Sl. No", "Specification", "Nominal (mm)", "+ Tol", "- Tol", "Method"];
    for (let i = 1; i <= sampleCount; i++) {
      headers.push(`Sample ${i}`);
    }
    headers.push("Remarks");

    output += headers.join("\t") + "\n";

    // Data rows
    inspectionRows.forEach(row => {
      const rowData = [
        row.id.toString(),
        row.specification || "",
        row.nominal || "",
        row.plusTol || "",
        row.minusTol || "",
        row.method || ""
      ];

      row.samples.forEach((sample: string) => {
        rowData.push(sample || "");
      });

      rowData.push(row.remarks || "");
      output += rowData.join("\t") + "\n";
    });

    output += `\nGeneral Remarks\n${generalRemarks}\n\nStatus\n${status}`;

    return output;
  };

  const copyFormattedOutput = () => {
    const output = generateFormattedOutput();
    navigator.clipboard.writeText(output).then(() => {
      toast.success("Formatted output copied to clipboard!");
    }).catch(() => {
      toast.error("Failed to copy to clipboard");
    });
  };

  // Generate comprehensive PDF report
  const generateComprehensivePDF = async () => {
    try {
      // Import jsPDF dynamically
      const { jsPDF } = await import('jspdf');

      const doc = new jsPDF('p', 'mm', 'a4');
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Title and header
      doc.setFontSize(20);
      doc.text('QC INSPECTION REPORT', pageWidth / 2, 20, { align: 'center' });

      doc.setFontSize(12);
      doc.text(`Inspection ID: ${inspectionId}`, 20, 35);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 45);

      let yPos = 60;

      // 1.3 BALLOON DRAWING Section
      doc.setFontSize(14);
      doc.text('1.3 BALLOON DRAWING', 20, yPos);
      yPos += 15;

      doc.setFontSize(10);
      const balloonData: [string, string][] = [
        [`Part Name: ${partName || 'N/A'}`, `Material: ${material || 'N/A'}`],
        [`Surface Treatment: ${surfaceTreatment || 'N/A'}`, `Drawing Title: ${drawingTitle || 'N/A'}`],
        [`Drawing Size: ${drawingSize || 'A4'}`, `Balloons: ${balloons.length} annotations`]
      ];

      balloonData.forEach(row => {
        doc.text(row[0], 20, yPos);
        doc.text(row[1], 120, yPos);
        yPos += 10;
      });

      yPos += 10;

      // 1.4 FINAL INSPECTION REPORT Section
      doc.setFontSize(14);
      doc.text('1.4 FINAL INSPECTION REPORT', 20, yPos);
      yPos += 15;

      doc.setFontSize(10);
      const inspectionData: [string, string][] = [
        [`Company Name: ${companyName || 'N/A'}`, `Revision Number: ${revisionNumber || 'N/A'}`],
        [`Inspection Date: ${inspectionDate || 'N/A'}`, `Raw Material: ${rawMaterial || 'N/A'}`],
        [`Inspection By: ${inspectionBy || 'N/A'}`, `Approved By: ${approvedBy || 'N/A'}`]
      ];

      inspectionData.forEach(row => {
        doc.text(row[0], 20, yPos);
        doc.text(row[1], 120, yPos);
        yPos += 10;
      });

      yPos += 15;

      // Inspection Table
      doc.setFontSize(14);
      doc.text('INSPECTION TABLE (SUMMARY)', 20, yPos);
      yPos += 10;

      // Add color legend
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text('Legend: ', 20, yPos);
      let legendX = doc.getTextWidth('Legend: ') + 25;

      doc.setTextColor(34, 139, 34);
      doc.text('Green = Within Tolerance', legendX, yPos);
      legendX += doc.getTextWidth('Green = Within Tolerance') + 15;

      doc.setTextColor(220, 20, 60);
      doc.text('Red = Out of Tolerance', legendX, yPos);

      doc.setTextColor(0, 0, 0); // Reset to black
      yPos += 10;

      // Table headers
      doc.setFontSize(8);
      const headers = ['Sl.No', 'Specification', 'Nominal', '+Tol', '-Tol', 'Method'];
      for (let i = 1; i <= sampleCount; i++) {
        headers.push(`S${i}`);
      }
      headers.push('Remarks');

      let xPos = 20;
      const colWidths = [15, 25, 20, 15, 15, 20, ...Array(sampleCount).fill(12), 25];

      // Draw header
      doc.setFillColor(240, 240, 240);
      doc.rect(20, yPos - 5, pageWidth - 40, 8, 'F');

      headers.forEach((header, index) => {
        doc.text(header, xPos + 2, yPos);
        xPos += colWidths[index];
      });

      yPos += 10;

      // Table rows with color coding
      inspectionRows.forEach((row, index) => {
        if (yPos > pageHeight - 30) {
          doc.addPage();
          yPos = 20;
        }

        // Calculate validation parameters
        const nominal = parseFloat(row.nominal) || 0;
        const plusTol = parseFloat(row.plusTol) || 0;
        const minusTol = parseFloat(row.minusTol) || 0;
        const upperLimit = nominal + plusTol;
        const lowerLimit = nominal + minusTol;

        // Alternate row colors
        if (index % 2 === 0) {
          doc.setFillColor(250, 250, 250);
          doc.rect(20, yPos - 5, pageWidth - 40, 8, 'F');
        }

        xPos = 20;

        // Row basic data (Sl.No, Specification, Nominal, +Tol, -Tol, Method)
        const basicData = [
          (index + 1).toString(),
          row.specification || '',
          row.nominal || '',
          row.plusTol || '',
          row.minusTol || '',
          row.method || ''
        ];

        // Draw basic data columns (no color)
        doc.setTextColor(0, 0, 0); // Black text
        basicData.forEach((data, colIndex) => {
          const text = data.toString().substring(0, 10);
          doc.text(text, xPos + 2, yPos);
          xPos += colWidths[colIndex];
        });

        // Draw sample values with color coding
        row.samples.forEach((sample: string, sampleIndex: number) => {
          if (sample && sample.trim() !== '' && row.nominal) {
            const sampleValue = parseFloat(sample);
            if (!isNaN(sampleValue)) {
              // Check if sample is within tolerance
              const isInTolerance = sampleValue >= lowerLimit && sampleValue <= upperLimit;

              // Set color based on tolerance
              if (isInTolerance) {
                doc.setTextColor(34, 139, 34); // Green for OK values
              } else {
                doc.setTextColor(220, 20, 60); // Red for NG values
              }
            } else {
              doc.setTextColor(0, 0, 0); // Black for non-numeric
            }
          } else {
            doc.setTextColor(128, 128, 128); // Gray for empty values
          }

          const text = (sample || '').toString().substring(0, 8);
          doc.text(text, xPos + 2, yPos);
          xPos += colWidths[6 + sampleIndex]; // Offset for sample columns
        });

        // Calculate and draw result with color
        const allSamplesValid = row.samples.every((sample: string) => {
          const value = parseFloat(sample);
          return !isNaN(value) && value >= lowerLimit && value <= upperLimit;
        });

        const hasValues = row.samples.some((sample: string) => sample.trim() !== '');
        let resultText = '';

        if (hasValues && row.nominal) {
          resultText = allSamplesValid ? 'OK' : 'NG';

          // Set result color
          if (resultText === 'OK') {
            doc.setTextColor(34, 139, 34); // Green for OK
          } else {
            doc.setTextColor(220, 20, 60); // Red for NG
          }
        } else {
          doc.setTextColor(128, 128, 128); // Gray for no data
        }

        doc.text(resultText, xPos + 2, yPos);

        // Reset text color to black
        doc.setTextColor(0, 0, 0);

        yPos += 8;
      });

      yPos += 15;

      // General Remarks
      if (generalRemarks) {
        if (yPos > pageHeight - 40) {
          doc.addPage();
          yPos = 20;
        }

        doc.setFontSize(12);
        doc.text('GENERAL REMARKS:', 20, yPos);
        yPos += 10;

        doc.setFontSize(10);
        const remarksLines = doc.splitTextToSize(generalRemarks, pageWidth - 40);
        doc.text(remarksLines, 20, yPos);
        yPos += remarksLines.length * 5;
      }

      // Status with color coding
      yPos += 10;
      doc.setFontSize(12);
      doc.text('STATUS: ', 20, yPos);

      // Color code the status
      const statusValue = status || 'release';
      const statusX = doc.getTextWidth('STATUS: ') + 20;

      if (statusValue.toLowerCase().includes('release') || statusValue.toLowerCase().includes('pass')) {
        doc.setTextColor(34, 139, 34); // Green for positive status
      } else if (statusValue.toLowerCase().includes('reject') || statusValue.toLowerCase().includes('fail')) {
        doc.setTextColor(220, 20, 60); // Red for negative status
      } else {
        doc.setTextColor(255, 165, 0); // Orange for neutral/pending status
      }

      doc.text(statusValue, statusX, yPos);
      doc.setTextColor(0, 0, 0); // Reset to black

      // Footer
      const totalPages = doc.internal.pages.length - 1;
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - 30, pageHeight - 10);
        doc.text('Generated by Mithran QC System', 20, pageHeight - 10);
      }

      // Save the PDF
      const filename = `QC-Inspection-Report-${partName || inspectionId}-${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(filename);

      toast.success('Complete inspection report downloaded successfully!');

    } catch (error) {
      toast.error('Failed to generate PDF report');
    }
  };


  // Clear all data function
  const clearInspectionData = () => {
    try {
      localStorage.removeItem(persistenceKey);

      // Reset to initial empty state
      setInspectionRows([]);
      setGeneralRemarks('');
      setStatus('release');
      setSampleCount(5);

      toast.success('Inspection data cleared');
    } catch (error) {
      toast.error('Failed to clear inspection data');
    }
  };

  // Handle extracted table data from PDF
  const handleExtractedTableData = (tableData: any) => {
    if (tableData.inspectionRows && tableData.inspectionRows.length > 0) {
      // Map extracted data to our inspection row format
      const extractedRows = tableData.inspectionRows.map((row: any, index: number) => ({
        id: `row-${index + 1}`,
        specification: row.specification || '',
        nominal: row.nominal || '',
        plusTol: row.plusTol || '+0.1',
        minusTol: row.minusTol || '-0.1',
        method: row.method || 'Caliper',
        samples: row.samples || Array(sampleCount).fill(''),
        remarks: row.remarks || ''
      }));

      // Replace existing rows with extracted data
      setInspectionRows(extractedRows);

      // Update sample count if different
      if (tableData.sampleCount && tableData.sampleCount !== sampleCount) {
        setSampleCount(tableData.sampleCount);
      }

      toast.success(`Successfully extracted ${extractedRows.length} inspection items from PDF!`);
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:gap-6 w-full min-w-0 max-w-full">
      {/* Page Header */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 mb-3 sm:mb-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
            <button
              onClick={() => router.push(`/projects/${projectId}/quality-control`)}
              className="hover:text-foreground transition-colors flex items-center gap-1"
            >
              Create Quality Report
            </button>
            <span>›</span>
            <span className="truncate">{inspection?.name || 'Inspection Report'}</span>
          </div>

          {/* Main Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              onClick={() => router.push(`/projects/${projectId}/quality-control`)}
              className="flex items-center gap-2 self-start"
              size="sm"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Create Quality Report</span>
              <span className="sm:hidden">Back</span>
            </Button>
            <div className="flex-1 min-w-0 w-full sm:w-auto">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold flex items-center gap-2">
                <Shield className="h-4 w-4 sm:h-5 sm:w-5 lg:h-6 lg:w-6" />
                <span className="truncate">QC Inspection Report</span>
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                {inspection?.name || 'Unknown'}
              </p>
            </div>
          </div>
        </div>

        {/* 2D Drawing Display */}
        <div className="w-full min-w-0">
          <Card>
            <CardHeader className="pb-2 sm:pb-3">
              <CardTitle className="text-base sm:text-lg">2D Technical Drawings</CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-hidden">
              {bomsLoading || bomItemsLoading ? (
                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg">
                  <div className="animate-spin h-8 w-8 mb-3 text-muted-foreground">⟳</div>
                  <p className="text-sm text-muted-foreground">Loading BOM items...</p>
                </div>
              ) : bomItems?.length > 0 ? (
                <div className="grid gap-3">
                  {bomItems.map((bomItem: any, index: number) => (
                    <div key={bomItem.id || index} className="border rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
                        <h4 className="font-medium text-sm">{bomItem.partNumber || bomItem.name || `Item ${index + 1}`}</h4>
                        <Badge variant="secondary" className="text-xs">{bomItem.itemType || 'Component'}</Badge>
                      </div>

                      <InlinePDFViewer
                        bomItem={bomItem}
                        onBalloonsChanged={setBalloons}
                        inspectionId={inspectionId}
                        onSaveToDatabaseSilently={saveToDatabaseSilently}
                        onTableDataExtracted={handleExtractedTableData}
                      />

                      {/* Item Details */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-muted/30 border-t">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Material</p>
                          <p className="text-sm font-mono">{bomItem.materialGrade || bomItem.material || 'Not specified'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Quantity</p>
                          <p className="text-sm font-mono">{bomItem.quantity || 'N/A'} {bomItem.unitOfMeasure || bomItem.unit || 'pcs'}</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Drawing Type</p>
                          <p className="text-sm font-mono">2D Technical</p>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground">Description</p>
                          <p className="text-sm font-mono truncate">{bomItem.description || 'N/A'}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : bomsError || bomItemsError ? (
                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg">
                  <FileText className="h-12 w-12 mb-3 text-destructive" />
                  <p className="text-sm text-destructive mb-2">Failed to load BOM data</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      bomsQuery.refetch();
                      bomItemsQuery.refetch();
                    }}
                  >
                    Try Again
                  </Button>
                </div>
              ) : !projectBOM ? (
                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg">
                  <FileText className="h-12 w-12 mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No BOM found for this project</p>
                  <p className="text-xs text-muted-foreground mt-1">Make sure the project has a BOM created</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg">
                  <FileText className="h-12 w-12 mb-3 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No BOM items found for this inspection</p>
                  <p className="text-xs text-muted-foreground mt-1">The BOM may be empty or still loading</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div> {/* end 2D Drawing container */}

        {/* Rest of page content */}
        <div className="space-y-4 sm:space-y-6 w-full min-w-0 mb-8">
          <Card className="min-w-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">1.3 BALLOON DRAWING</CardTitle>
                <div className="flex gap-2">
                  {balloonDrawingEditMode ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setBalloonDrawingEditMode(false);
                          toast.success('Changes saved');
                        }}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setBalloonDrawingEditMode(false)}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setBalloonDrawingEditMode(true)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 p-3 sm:p-6">
              <DisplayField
                label="Part Name"
                value={partName}
                onChange={setPartName}
                placeholder="e.g., Camera Holder"
                isEditing={balloonDrawingEditMode}
                required
              />
              <DisplayField
                label="Material"
                value={material}
                onChange={setMaterial}
                placeholder="e.g., Aluminium 6061-T6"
                isEditing={balloonDrawingEditMode}
                required
              />
              <DisplayField
                label="Surface Treatment"
                value={surfaceTreatment}
                onChange={setSurfaceTreatment}
                placeholder="e.g., Black Anodized"
                isEditing={balloonDrawingEditMode}
              />
              <DisplayField
                label="Drawing Title"
                value={drawingTitle}
                onChange={setDrawingTitle}
                placeholder="e.g., CAMERA HOLDER"
                isEditing={balloonDrawingEditMode}
              />
              <DisplayField
                label="Drawing Size"
                value={drawingSize}
                onChange={setDrawingSize}
                placeholder="e.g., A4"
                isEditing={balloonDrawingEditMode}
              />
            </CardContent>
          </Card>

          {/* Final Inspection Report */}
          <Card className="min-w-0">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">1.4 FINAL INSPECTION REPORT</CardTitle>
                <div className="flex gap-2">
                  {finalInspectionEditMode ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setFinalInspectionEditMode(false);
                          toast.success('Changes saved');
                        }}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setFinalInspectionEditMode(false)}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setFinalInspectionEditMode(true)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <DisplayField
                  label="Company Name"
                  value={companyName}
                  onChange={setCompanyName}
                  placeholder="EMUSKI"
                  isEditing={finalInspectionEditMode}
                />
                <DisplayField
                  label="Revision Number"
                  value={revisionNumber}
                  onChange={setRevisionNumber}
                  placeholder="—"
                  isEditing={finalInspectionEditMode}
                />
                <DisplayField
                  label="Inspection Date"
                  value={inspectionDate}
                  onChange={setInspectionDate}
                  type="date"
                  isEditing={finalInspectionEditMode}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                <DisplayField
                  label="Raw Material"
                  value={rawMaterial}
                  onChange={setRawMaterial}
                  placeholder="e.g., Aluminium 6061-T6"
                  isEditing={finalInspectionEditMode}
                  required
                />
                <DisplayField
                  label="Inspection By"
                  value={inspectionBy}
                  onChange={setInspectionBy}
                  placeholder="Inspector name"
                  isEditing={finalInspectionEditMode}
                  required
                />
                <DisplayField
                  label="Approved By"
                  value={approvedBy}
                  onChange={setApprovedBy}
                  placeholder="Approver name"
                  isEditing={finalInspectionEditMode}
                />
              </div>
            </CardContent>
          </Card>

          {/* Inspection Table */}
          <Card className="min-w-0">
            <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
                <CardTitle className="text-base sm:text-lg w-full truncate">Inspection Table (Summary)</CardTitle>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs sm:text-sm whitespace-nowrap">Samples:</Label>
                    <TableDisplayField
                      value={sampleCount.toString()}
                      onChange={(value) => updateSampleCount(parseInt(value) || 1)}
                      placeholder="5"
                      type="number"
                      isEditing={inspectionTableEditMode}
                      className="w-12 sm:w-16 text-xs sm:text-sm"
                    />
                  </div>
                  {inspectionTableEditMode ? (
                    <>
                      <Button onClick={addInspectionRow} size="sm">
                        Add Row
                      </Button>
                      <Button
                        onClick={clearInspectionData}
                        size="sm"
                        variant="outline"
                      >
                        Clear All
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setInspectionTableEditMode(false);
                          toast.success('Table changes saved');
                        }}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setInspectionTableEditMode(false)}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setInspectionTableEditMode(true)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-3 sm:p-6 pt-0">
              <div className="overflow-x-auto w-full pb-2">
                <div className="space-y-3 min-w-max">
                  {/* Table Header */}
                  <div className={`grid gap-2 text-xs font-medium bg-muted p-2 rounded`} style={{ gridTemplateColumns: `50px 120px 90px 70px 70px 80px repeat(${sampleCount}, 80px) 120px` }}>
                    <div>Sl. No</div>
                    <div>Specification</div>
                    <div>Nominal (mm)</div>
                    <div>+ Tol</div>
                    <div>- Tol</div>
                    <div>Method</div>
                    {Array.from({ length: sampleCount }, (_, i) => (
                      <div key={i}>Sample {i + 1}</div>
                    ))}
                    <div>Remarks</div>
                  </div>

                  {/* Table Rows */}
                  {inspectionRows.map((row, index) => (
                    <div key={row.id} className="grid gap-2 items-center" style={{ gridTemplateColumns: `50px 120px 90px 70px 70px 80px repeat(${sampleCount}, 80px) 120px` }}>
                      <div className="text-sm text-center">{index + 1}</div>
                      <TableDisplayField
                        value={row.specification}
                        onChange={(value) => updateInspectionRow(row.id, 'specification', value)}
                        placeholder="Length"
                        isEditing={inspectionTableEditMode}
                      />
                      <TableDisplayField
                        value={row.nominal}
                        onChange={(value) => updateInspectionRow(row.id, 'nominal', value)}
                        placeholder="40"
                        type="number"
                        isEditing={inspectionTableEditMode}
                      />
                      <TableDisplayField
                        value={row.plusTol}
                        onChange={(value) => updateInspectionRow(row.id, 'plusTol', value)}
                        placeholder="0.1"
                        type="number"
                        isEditing={inspectionTableEditMode}
                      />
                      <TableDisplayField
                        value={row.minusTol}
                        onChange={(value) => updateInspectionRow(row.id, 'minusTol', value)}
                        placeholder="-0.1"
                        type="number"
                        isEditing={inspectionTableEditMode}
                      />
                      <TableDisplayField
                        value={row.method}
                        onChange={(value) => updateInspectionRow(row.id, 'method', value)}
                        placeholder="DVC"
                        isEditing={inspectionTableEditMode}
                      />
                      {row.samples.map((sample: string, index: number) => (
                        <div key={index}>
                          {inspectionTableEditMode ? (
                            <Input
                              type="number"
                              value={sample}
                              onChange={(e) => updateInspectionRow(row.id, 'sample', e.target.value, index)}
                              placeholder="40.00"
                              className="text-xs"
                            />
                          ) : (
                            <div className="text-xs py-1">
                              {sample ? (() => {
                                const nominal = parseFloat(row.nominal) || 0;
                                const plusTol = parseFloat(row.plusTol) || 0;
                                const minusTol = parseFloat(row.minusTol) || 0;
                                const upperLimit = nominal + plusTol;
                                const lowerLimit = nominal + minusTol;
                                const sampleValue = parseFloat(sample);

                                if (isNaN(sampleValue) || !row.nominal) {
                                  return <span>{sample}</span>;
                                }

                                const isInTolerance = sampleValue >= lowerLimit && sampleValue <= upperLimit;
                                const colorClass = isInTolerance
                                  ? 'text-green-600 font-semibold'
                                  : 'text-red-600 font-semibold';

                                return <span className={colorClass}>{sample}</span>;
                              })() : (
                                <span className="text-muted-foreground italic">Not set</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      <div className="flex gap-1">
                        <div className="text-xs py-1 flex items-center flex-1">
                          {(() => {
                            const nominal = parseFloat(row.nominal) || 0;
                            const plusTol = parseFloat(row.plusTol) || 0;
                            const minusTol = parseFloat(row.minusTol) || 0;
                            const upperLimit = nominal + plusTol;
                            const lowerLimit = nominal + minusTol;

                            const allSamplesValid = row.samples.every((sample: string) => {
                              const value = parseFloat(sample);
                              return !isNaN(value) && value >= lowerLimit && value <= upperLimit;
                            });

                            const hasValues = row.samples.some((sample: string) => sample.trim() !== '');

                            if (!hasValues || !row.nominal) return '';

                            const result = allSamplesValid ? 'OK' : 'NG';
                            const colorClass = result === 'OK' ? 'text-green-600 font-semibold' :
                              result === 'NG' ? 'text-red-600 font-semibold' : '';

                            return <span className={colorClass}>{result}</span>;
                          })()}
                        </div>
                        {inspectionRows.length > 1 && (
                          <Button
                            onClick={() => removeInspectionRow(row.id)}
                            size="sm"
                            variant="outline"
                            className="px-2"
                          >
                            ×
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-4">
                <div className="flex items-center justify-between mb-4">
                  <div></div>
                  <div className="flex gap-2">
                    {inspectionTableEditMode ? (
                      <span className="text-xs text-muted-foreground">Edit mode active above</span>
                    ) : null}
                  </div>
                </div>
                <DisplayTextarea
                  label="General Remarks"
                  value={generalRemarks}
                  onChange={setGeneralRemarks}
                  placeholder="Add general remarks about the inspection..."
                  rows={3}
                  isEditing={inspectionTableEditMode}
                />
                <div className="grid grid-cols-1 gap-3 sm:gap-4">
                  <div key={`status-${status}`} className="space-y-2">
                    <Label className="flex items-center gap-2">
                      Status
                      <Badge
                        key={`status-badge-${status}`}
                        variant={
                          status === 'draft' ? 'secondary' :
                            status === 'release' ? 'default' :
                              'destructive'
                        }
                        className={`text-xs ${status === 'release' ? 'bg-primary text-primary-foreground hover:bg-primary/80' : ''}`}
                      >
                        {status?.toUpperCase() || 'UNKNOWN'}
                      </Badge>
                    </Label>
                    {inspectionTableEditMode ? (
                      <Input
                        key={`status-input-${status}`}
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        placeholder="release"
                      />
                    ) : (
                      <div key={`status-display-${status}`} className="p-2 border rounded bg-primary/10 border-primary/20 text-primary font-medium">
                        {status?.toUpperCase() || 'Not Set'}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3 sm:gap-4 pt-3 sm:pt-4 border-t">
            <div className="flex flex-wrap gap-2 justify-center sm:justify-start">
              <Button
                variant="outline"
                size="sm"
                onClick={generateComprehensivePDF}
                className="flex items-center gap-2 text-xs sm:text-sm"
              >
                <Download className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Download Full Report</span>
                <span className="sm:hidden">Download</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={copyFormattedOutput}
                className="flex items-center gap-2 text-xs sm:text-sm"
              >
                <FileText className="h-3 w-3 sm:h-4 sm:w-4" />
                <span className="hidden sm:inline">Copy Output</span>
                <span className="sm:hidden">Copy</span>
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
              {/* Status Indicator */}
              <div className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-md border text-xs sm:text-sm ${status === 'draft' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' :
                status === 'release' ? 'bg-primary/10 border-primary/20 text-primary' :
                  status === 'rejected' ? 'bg-red-50 border-red-200 text-red-800' :
                    'bg-gray-50 border-gray-200 text-gray-600'
                }`}>
                <div className={`${status === 'draft' ? 'text-yellow-600' :
                  status === 'release' ? 'text-primary' :
                    status === 'rejected' ? 'text-red-600' :
                      'text-gray-400'
                  }`}>
                  {status === 'draft' ? <Clock className="h-3 w-3 sm:h-4 sm:w-4" /> :
                    status === 'release' ? <CheckCircle className="h-3 w-3 sm:h-4 sm:w-4" /> :
                      status === 'rejected' ? <XCircle className="h-3 w-3 sm:h-4 sm:w-4" /> :
                        <Clock className="h-3 w-3 sm:h-4 sm:w-4" />}
                </div>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {status === 'draft' ? 'Draft Saved' :
                      status === 'release' ? 'Report Submitted' :
                        status === 'rejected' ? 'Report Rejected' :
                          'Not Saved'}
                  </span>
                  {lastSavedTime && (
                    <span className="text-xs opacity-70 hidden sm:block">
                      {lastSavedTime}
                    </span>
                  )}
                </div>
              </div>

              <Button
                variant="secondary"
                size="sm"
                className="flex items-center gap-2 text-xs sm:text-sm"
                onClick={() => handleSaveReport(true)}
                disabled={saveInspectionReport.isPending}
              >
                {saveInspectionReport.isPending ? (
                  <div className="animate-spin h-3 w-3 sm:h-4 sm:w-4">⟳</div>
                ) : (
                  <Save className="h-3 w-3 sm:h-4 sm:w-4" />
                )}
                <span className="hidden sm:inline">Save Draft</span>
                <span className="sm:hidden">Draft</span>
              </Button>
              {!inspectionLoading && currentInspection?.status !== 'completed' && currentInspection?.status !== 'approved' && currentInspection?.status !== 'rejected' && (
                <Button
                  size="sm"
                  className="flex items-center gap-2 text-xs sm:text-sm"
                  onClick={async () => {
                    // First save the report silently
                    await handleSaveReport(false, true);
                    // Then complete the inspection
                    await handleCompleteInspection();
                  }}
                  disabled={saveInspectionReport.isPending || updateInspection.isPending || !inspectionBy}
                >
                  {(saveInspectionReport.isPending || updateInspection.isPending) ? (
                    <div className="animate-spin h-3 w-3 sm:h-4 sm:w-4">⟳</div>
                  ) : (
                    <Send className="h-3 w-3 sm:h-4 sm:w-4" />
                  )}
                  <span className="hidden sm:inline">Submit &amp; Complete</span>
                  <span className="sm:hidden">Submit</span>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}