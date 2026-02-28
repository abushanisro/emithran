'use client';

// Type declaration for html2canvas
declare module 'html2canvas' {
  interface Html2CanvasOptions {
    backgroundColor?: string;
    scale?: number;
    useCORS?: boolean;
    allowTaint?: boolean;
    foreignObjectRendering?: boolean;
    logging?: boolean;
  }
  function html2canvas(element: HTMLElement, options?: Html2CanvasOptions): Promise<HTMLCanvasElement>;
  export default html2canvas;
}

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useAuth } from '@/lib/providers/auth';
import { useAuthEnabled } from '@/lib/api/hooks/useAuthEnabled';
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
import InteractiveBalloonAnnotator from '@/components/features/quality-control/InteractiveBalloonAnnotator';

// Editable Field Component
interface EditableFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'date' | 'number';
  className?: string;
}

function EditableField({ 
  label, 
  value, 
  onChange, 
  placeholder, 
  required = false, 
  type = 'text',
  className = ''
}: EditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  const handleSave = () => {
    onChange(tempValue);
    setIsEditing(false);
    toast.success(`${label} updated`);
  };

  const handleCancel = () => {
    setTempValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'date') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </Label>
      
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            type={type}
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1"
            autoFocus
          />
          <Button
            size="sm"
            variant="outline"
            onClick={handleSave}
            className="px-2"
          >
            <Check className="h-4 w-4 text-green-600" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            className="px-2"
          >
            <X className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/30">
          <span className="flex-1 text-sm">
            {value || <span className="text-muted-foreground italic">{placeholder || 'Click to add...'}</span>}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsEditing(true)}
            className="px-2 h-6"
          >
            <Edit className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}

// Editable Textarea Component
interface EditableTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  className?: string;
}

function EditableTextarea({ 
  label, 
  value, 
  onChange, 
  placeholder, 
  required = false, 
  rows = 3,
  className = ''
}: EditableTextareaProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  const handleSave = () => {
    onChange(tempValue);
    setIsEditing(false);
    toast.success(`${label} updated`);
  };

  const handleCancel = () => {
    setTempValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <Label className="flex items-center gap-1">
        {label}
        {required && <span className="text-red-500">*</span>}
      </Label>
      
      {isEditing ? (
        <div className="space-y-2">
          <Textarea
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={rows}
            autoFocus
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSave}
              className="px-2"
            >
              <Check className="h-4 w-4 text-green-600 mr-1" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              className="px-2"
            >
              <X className="h-4 w-4 text-red-600 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-start gap-2 p-3 border rounded-md bg-muted/30 min-h-[80px]">
            <div className="flex-1 text-sm">
              {value ? (
                <pre className="whitespace-pre-wrap font-sans">{value}</pre>
              ) : (
                <span className="text-muted-foreground italic">{placeholder || 'Click to add...'}</span>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              className="px-2 h-6 shrink-0"
            >
              <Edit className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Table Editable Field Component (compact version for table cells)
interface TableEditableFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number';
  className?: string;
}

function TableEditableField({ 
  value, 
  onChange, 
  placeholder,
  type = 'text',
  className = ''
}: TableEditableFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  const handleSave = () => {
    onChange(tempValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    } else if (e.key === 'Tab') {
      handleSave();
    }
  };

  const handleBlur = () => {
    handleSave();
  };

  return (
    <>
      {isEditing ? (
        <Input
          type={type}
          value={tempValue}
          onChange={(e) => setTempValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={`text-xs ${className}`}
          autoFocus
        />
      ) : (
        <div 
          onClick={() => setIsEditing(true)}
          className={`text-xs p-2 bg-background rounded border min-h-[32px] flex items-center cursor-pointer hover:bg-muted/50 transition-colors ${className}`}
        >
          {value || <span className="text-muted-foreground italic">{placeholder}</span>}
        </div>
      )}
    </>
  );
}

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
      
      console.log('🎯 Extracting with balloons:', balloonCoordinates);
      console.log('🔍 Sending API request to /api/extract-inspection-table...');
      
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
        console.error('❌ API request failed:', extractResponse.status, extractResponse.statusText);
        throw new Error('Failed to extract table data from PDF');
      }
      
      console.log('✅ API request successful, parsing response...');
      const tableData = await extractResponse.json();
      console.log('📋 Received table data:', tableData);
      
      if (tableData.inspectionRows && tableData.inspectionRows.length > 0) {
        console.log('💾 Calling onTableDataExtracted with data...');
        onTableDataExtracted(tableData);
        console.log('✅ onTableDataExtracted called successfully');
        
        if (balloonCoordinates.length > 0) {
          const successfulExtractions = tableData.successfulExtractions || tableData.inspectionRows.filter(row => row.nominal && row.nominal !== '').length;
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
      console.error('Error extracting table from PDF:', error);
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
      console.log('Saved balloons:', balloons);
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
      const { width, height } = firstPage.getSize();
      
      console.log(`PDF dimensions: ${width}x${height}`);
      
      // Get the iframe element to match its exact dimensions
      const iframeElement = document.querySelector('iframe[title="2D Technical Drawing"]') as HTMLIFrameElement;
      const iframeRect = iframeElement?.getBoundingClientRect();
      
      console.log(`PDF page size: ${width}x${height}`);
      console.log(`Screen iframe size: ${iframeRect?.width}x${iframeRect?.height}`);
      
      // Calculate scaling factors to match screen display exactly
      const scaleX = iframeRect ? width / iframeRect.width : 1;
      const scaleY = iframeRect ? height / iframeRect.height : 1;
      
      console.log(`Scale factors: X=${scaleX}, Y=${scaleY}`);
      
      // Draw balloons on the PDF with exact screen alignment
      balloons.forEach(balloon => {
        // Convert percentage coordinates to exact screen pixel coordinates first
        const screenX = iframeRect ? (balloon.x / 100) * iframeRect.width : (balloon.x / 100) * width;
        const screenY = iframeRect ? (balloon.y / 100) * iframeRect.height : (balloon.y / 100) * height;
        
        // Then convert screen coordinates to PDF coordinates
        const pdfX = screenX * scaleX;
        const pdfY = height - (screenY * scaleY); // PDF coordinates are bottom-up, screen is top-down
        
        console.log(`Balloon ${balloon.number}: Screen(${balloon.x}%, ${balloon.y}%) -> ScreenPx(${screenX}, ${screenY}) -> PDF(${pdfX}, ${pdfY})`);
        
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
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${bomItem.partNumber || bomItem.name || 'drawing'}-with-balloons.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      
      toast.success(`Downloaded PDF with ${balloons.length} balloon annotations`);
      
    } catch (error) {
      console.error('Error generating PDF with balloons:', error);
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
        console.log(`Loaded ${parsed.length} balloons for item ${bomItem.id}`);
      }
      
      // Also check global saved data
      if (window.savedBalloonData && window.savedBalloonData[bomItem.id]) {
        setBalloons(window.savedBalloonData[bomItem.id]);
        console.log(`Loaded balloons from global save for item ${bomItem.id}`);
      }
    } catch (error) {
      console.error('Error loading balloons from storage:', error);
    }
  };
  
  // Save balloons to localStorage and database whenever they change
  useEffect(() => {
    if (balloons.length > 0 || localStorage.getItem(balloonStorageKey)) {
      localStorage.setItem(balloonStorageKey, JSON.stringify(balloons));
      
      // Also save to global object for main persistence
      if (!window.balloonDataForSave) window.balloonDataForSave = {};
      window.balloonDataForSave[bomItem.id] = balloons;
      
      console.log(`💾 Auto-saved ${balloons.length} balloons for item ${bomItem.id}`);
      
      // Auto-save balloons to database when they change (debounced)
      if (balloons.length > 0 && onSaveToDatabaseSilently) {
        const timer = setTimeout(() => {
          onSaveToDatabaseSilently();
        }, 2000); // Wait 2 seconds after balloon changes stop
        
        return () => clearTimeout(timer);
      }
    }
  }, [balloons, balloonStorageKey, bomItem.id]);

  const loadPDF = async () => {
    if (!drawingFile) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Get token from Supabase auth session
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        throw new Error('No authentication token available. Please log in again.');
      }
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bom-items/${bomItem.id}/file-url/2d`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Try different possible response formats
        const possibleUrl = data.url || data.signedUrl || data.downloadUrl || data.fileUrl || data.data?.url;
        
        if (possibleUrl) {
          setPdfUrl(possibleUrl);
        } else {
          throw new Error(`No URL returned from server. Response: ${JSON.stringify(data)}`);
        }
      } else {
        const errorText = await response.text();
        throw new Error(`Failed to get PDF URL: ${response.status} - ${errorText}`);
      }
    } catch (err) {
      console.error('Error loading PDF:', err);
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
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Drawing file: {drawingFile}</p>
      <div className="border border-border rounded-lg bg-card shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center p-8">
            <div className="text-center">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading 2D Drawing...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center p-8">
            <FileText className="h-12 w-12 mb-3 text-muted-foreground" />
            <p className="text-sm text-red-500 mb-2">Failed to load PDF</p>
            <p className="text-xs text-muted-foreground mb-3">{error}</p>
            <Button onClick={loadPDF} variant="outline" size="sm">
              Try Again
            </Button>
          </div>
        ) : pdfUrl ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-muted">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{bomItem.partNumber || bomItem.name} - 2D Drawing</span>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={toggleAnnotationMode}
                  variant={isAnnotationMode ? "destructive" : "default"}
                  size="sm"
                  className={isAnnotationMode ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"}
                >
                  <Edit3 className="h-4 w-4 mr-1" />
                  {isAnnotationMode ? 'Save Balloons' : 'Add Balloons'}
                </Button>
                {isAnnotationMode && balloons.length > 0 && (
                  <Button
                    onClick={() => {
                      setBalloons([]);
                      setSelectedBalloon(null);
                    }}
                    variant="outline"
                    size="sm"
                  >
                    Clear All
                  </Button>
                )}
                {isAnnotationMode && (
                  <div className="flex items-center gap-1 text-sm text-red-600 font-medium">
                    {isDragging ? 'Dragging balloon...' : 'Click to add • Drag to move • Double-click to edit number'}
                  </div>
                )}
                <Button
                  onClick={() => window.open(pdfUrl, '_blank')}
                  variant="outline"
                  size="sm"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Open Full Size
                </Button>
                <Button
                  onClick={downloadPDFWithBalloons}
                  variant="outline"
                  size="sm"
                  disabled={isGeneratingPDF}
                >
                  {isGeneratingPDF ? (
                    <div className="animate-spin h-4 w-4 mr-1">⟳</div>
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  {balloons.length > 0 ? 'Download with Balloons' : 'Download PDF'}
                </Button>
                <Button
                  onClick={extractInspectionTableFromPDF}
                  variant="default"
                  size="sm"
                  disabled={!pdfUrl || isExtractingTable}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isExtractingTable ? (
                    <div className="animate-spin h-4 w-4 mr-1">⟳</div>
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  Extract Table Data
                </Button>
              </div>
            </div>
            <div 
              className={`w-full relative ${isAnnotationMode ? 'cursor-crosshair' : ''}`}
              style={{ minHeight: '800px', height: '100vh', overflow: 'hidden' }}
              onClick={isAnnotationMode ? handleOverlayClick : undefined}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              data-pdf-container
            >
              {/* PDF iframe - full display without scroll */}
              <iframe
                src={`${pdfUrl}#view=FitH&scrollbar=0&toolbar=0&navpanes=0`}
                title="2D Technical Drawing"
                className="w-full border-0"
                sandbox="allow-same-origin"
                style={{ 
                  height: '100vh',
                  minHeight: '800px',
                  overflow: 'hidden',
                  pointerEvents: isAnnotationMode ? 'none' : 
                                balloons.length > 0 && !isAnnotationMode ? 'none' : 'auto'
                }}
              />

              {/* Balloon Overlays - show when annotating OR when balloons exist */}
              {(isAnnotationMode || balloons.length > 0) && (
                <>
                  {/* Balloons */}
                  {balloons.map((balloon) => (
                    <div
                      key={balloon.id}
                      className={`absolute transform -translate-x-1/2 -translate-y-1/2 transition-all select-none ${
                        isAnnotationMode ? (isDragging && selectedBalloon === balloon.id ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
                      } ${
                        selectedBalloon === balloon.id && isAnnotationMode
                          ? 'ring-4 ring-blue-500 ring-opacity-50' 
                          : ''
                      } ${
                        isDragging && selectedBalloon === balloon.id ? 'z-50 scale-110' : ''
                      }`}
                      style={{
                        left: `${balloon.x}%`,
                        top: `${balloon.y}%`,
                        zIndex: 10
                      }}
                      onMouseDown={(e) => handleMouseDown(e, balloon.id)}
                      onDoubleClick={(e) => handleDoubleClick(e, balloon.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        // Only allow selection in annotation mode
                        if (isAnnotationMode && !isDragging) {
                          setSelectedBalloon(balloon.id);
                        }
                      }}
                    >
                      <div className="relative">
                        <div 
                          className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold shadow-lg transition-all ${
                            selectedBalloon === balloon.id && isAnnotationMode
                              ? 'bg-red-600 border-red-700 text-white scale-110'
                              : `bg-red-500 border-red-700 text-white ${isAnnotationMode ? 'hover:bg-red-600' : ''}`
                          } ${
                            isDragging && selectedBalloon === balloon.id ? 'shadow-2xl' : ''
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
                              min="1"
                              max="99"
                            />
                          ) : (
                            balloon.number
                          )}
                        </div>
                        
                        {/* Delete button for selected balloon - only in annotation mode */}
                        {selectedBalloon === balloon.id && isAnnotationMode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteBalloon(balloon.id);
                            }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-gray-800 text-white rounded-full flex items-center justify-center text-xs hover:bg-gray-900"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Instructions overlay when in annotation mode */}
                  {balloons.length === 0 && isAnnotationMode && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black bg-opacity-10 instruction-overlay" style={{ zIndex: 5 }}>
                      <div className="bg-white bg-opacity-90 rounded-lg p-4 text-center border border-red-200 shadow-lg">
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

            {/* Removed dimension input dialog */}
            {false && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
                  <h3 className="text-lg font-semibold mb-4">
                    Enter Dimension for Balloon #{balloons.find(b => b.id === showDimensionInput)?.number}
                  </h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.target as HTMLFormElement);
                      const dimension = formData.get('dimension') as string;
                      const unit = formData.get('unit') as string;
                      const tolerance = formData.get('tolerance') as string;
                      updateBalloonDimension(showDimensionInput, dimension, unit, tolerance);
                    }}
                  >
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="dimension">Dimension Value</Label>
                        <Input
                          id="dimension"
                          name="dimension"
                          type="text"
                          placeholder="e.g., 25.4, R5, ∅12"
                          defaultValue={balloons.find(b => b.id === showDimensionInput)?.dimension || ''}
                          required
                          autoFocus
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="unit">Unit</Label>
                          <select
                            id="unit"
                            name="unit"
                            className="w-full p-2 border border-gray-300 rounded"
                            defaultValue={balloons.find(b => b.id === showDimensionInput)?.unit || 'mm'}
                          >
                            <option value="mm">mm</option>
                            <option value="cm">cm</option>
                            <option value="in">inch</option>
                            <option value="°">degrees</option>
                          </select>
                        </div>
                        
                        <div>
                          <Label htmlFor="tolerance">Tolerance (optional)</Label>
                          <Input
                            id="tolerance"
                            name="tolerance"
                            type="text"
                            placeholder="e.g., 0.1, 0.05"
                            defaultValue={balloons.find(b => b.id === showDimensionInput)?.tolerance || ''}
                          />
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-3 mt-6">
                      <Button type="submit" className="flex-1">
                        Save Dimension
                      </Button>
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={() => setShowDimensionInput(null)}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Removed dimension summary */}
            {false && (
              <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
                <h5 className="text-sm font-medium text-green-800 mb-3">📏 Added Dimensions</h5>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {balloons
                    .sort((a, b) => a.number - b.number)
                    .map((balloon) => (
                      <div 
                        key={balloon.id} 
                        className="flex items-center gap-2 p-2 bg-white rounded border border-green-300"
                      >
                        <div className="w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                          {balloon.number}
                        </div>
                        <div className="flex-1">
                          {balloon.dimension ? (
                            <div>
                              <div className="font-medium text-sm">
                                {balloon.dimension} {balloon.unit}
                              </div>
                              {balloon.tolerance && (
                                <div className="text-xs text-gray-600">±{balloon.tolerance}</div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500 italic">No dimension set</div>
                          )}
                        </div>
                        <button
                          onClick={() => setShowDimensionInput(balloon.id)}
                          className="text-blue-500 hover:text-blue-700 text-xs"
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            )}
            
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
  const { user, loading: authLoading } = useAuth();
  const isAuthEnabled = useAuthEnabled();
  
  // Import and debug app readiness
  const { appReadiness } = require('@/lib/core/app-readiness');
  console.log('Auth Debug:', { 
    user: !!user, 
    authLoading, 
    isAuthEnabled,
    appState: appReadiness.getState(),
    isAppReady: appReadiness.isReady(),
    isAuthReady: appReadiness.isAuthReady()
  });

  // Fetch BOMs for the project - bypass readiness check temporarily
  const bomsQuery = useQuery({
    queryKey: ['bom', 'list', { projectId }],
    queryFn: async () => {
      const { supabase } = await import('@/lib/supabase/client');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const params = new URLSearchParams();
      if (projectId) params.append('projectId', projectId);
      const queryString = params.toString();
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/boms${queryString ? `?${queryString}` : ''}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) throw new Error(`Failed to fetch BOMs: ${response.status}`);
      return await response.json();
    },
    enabled: !!user && !!projectId,
    staleTime: 1000 * 60 * 5,
  });
  const { data: bomsData, isLoading: bomsLoading, error: bomsError } = bomsQuery;
  
  console.log('=== BOM DATA DEBUGGING ===');
  console.log('Project ID:', projectId);
  console.log('User:', user);
  console.log('BOMs Loading:', bomsLoading);
  console.log('BOMs Error:', bomsError);
  console.log('BOMs Raw Data:', bomsData);
  console.log('BOMs Data Type:', typeof bomsData);
  console.log('BOMs Data Keys:', bomsData ? Object.keys(bomsData) : 'no data');
  
  // Try multiple extraction patterns
  const bomExtractionAttempts = {
    attempt1: bomsData?.data?.boms?.[0],
    attempt2: bomsData?.boms?.[0], 
    attempt3: bomsData?.data?.[0],
    attempt4: bomsData?.[0],
    attempt5: bomsData?.data,
    attempt6: bomsData
  };
  console.log('BOM Extraction Attempts:', bomExtractionAttempts);

  // Get the first BOM for this project (or the most recent one)
  const projectBOM = bomsData?.data?.boms?.[0] || bomsData?.boms?.[0] || bomsData?.data?.[0] || bomsData?.[0];
  
  console.log('Final Extracted Project BOM:', projectBOM);
  console.log('Project BOM ID:', projectBOM?.id);

  // Mock inspection data - replace with actual API call
  const inspection = {
    id: inspectionId,
    name: 'quality report emuski',
    bomId: projectBOM?.id,
    selectedItems: []
  };

  // Fetch BOM items for the inspection - bypass readiness check temporarily  
  console.log('=== BOM ITEMS DEBUGGING ===');
  console.log('Inspection BOM ID:', inspection?.bomId);
  console.log('Calling BOM Items API directly to bypass app readiness...');
  
  const bomItemsQuery = useQuery({
    queryKey: ['bom-items', 'list', inspection?.bomId],
    queryFn: async () => {
      if (!inspection?.bomId) return { items: [] };
      
      const { supabase } = await import('@/lib/supabase/client');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/bom-items?bomId=${inspection.bomId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
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
  
  console.log('BOM Items Direct API Response:', {
    data: bomItemsData,
    loading: bomItemsLoading,
    error: bomItemsError
  });

  // Get BOM items for inspection
  const getBOMItemsForInspection = () => {
    if (bomItemsLoading) {
      console.log('BOM items still loading...');
      return [];
    }

    if (bomItemsError) {
      console.error('BOM items error:', bomItemsError);
      return [];
    }

    // Extract items from the API response structure
    const items = bomItemsData?.data?.items || bomItemsData?.items || [];
    
    if (!items || items.length === 0) {
      console.log('No BOM items data found:', { 
        bomItemsData, 
        extractedItems: items,
        projectId, 
        inspection,
        projectBOM,
        bomsData,
        bomId: inspection?.bomId,
        hasProjectBOM: !!projectBOM,
        userReady: !!user
      });
      return [];
    }
    
    console.log('BOM Items Data Extracted Successfully:', items);
    
    // Return all items for this project's BOM for now
    // TODO: Filter based on actual inspection selection
    return items;
  };

  const bomItems = getBOMItemsForInspection();
  
  console.log('Final BOM Items for inspection:', bomItems);
  console.log('Project BOM:', projectBOM);

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
  const [inspectionDate, setInspectionDate] = useState(new Date().toISOString().split('T')[0]);
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
  
  // Debug: Log status changes
  useEffect(() => {
    console.log('🏷️ Status updated in UI:', status);
  }, [status]);

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
        
        console.log('Restored inspection data from localStorage:', parsed);
      }
    } catch (error) {
      console.error('Error loading persisted inspection data:', error);
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
      console.error('Error saving inspection data to localStorage:', error);
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
    console.log('Report loading state:', { existingReport, reportLoading, hasReport: !!existingReport });
    
    // Only load if we actually have report data (not null/404 error)
    if (existingReport && !reportLoading && existingReport !== null && typeof existingReport === 'object' && existingReport.inspectionId) {
      console.log('✅ Loading existing report from database:', existingReport);
      
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
            console.log(`✅ Loaded ${balloonDrawing.balloonAnnotations.length} balloons from database:`, balloonDrawing.balloonAnnotations);
          }
        }
        
        // Load final inspection report data
        const { finalInspectionReport } = existingReport;
        if (finalInspectionReport) {
          setCompanyName(finalInspectionReport.companyName || 'EMUSKI');
          setRevisionNumber(finalInspectionReport.revisionNumber || '—');
          setInspectionDate(finalInspectionReport.inspectionDate || new Date().toISOString().split('T')[0]);
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
        console.error('Error loading existing report data:', error);
        toast.error('Failed to load existing report data');
      }
    } else if (existingReport === null && !reportLoading) {
      console.log('✅ No existing report found (404) - using defaults');
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
      console.log('⏸️ Skipping auto-save: missing required fields');
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
        inspectionDate: inspectionDate || new Date().toISOString().split('T')[0],
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
          sampleValues: row.samples ? row.samples.map(s => parseFloat(s) || 0) : Array(sampleCount).fill(0),
          remarks: row.remarks || ''
        }))
      }
    };

    try {
      await saveInspectionReport.mutateAsync(reportData);
      console.log(`🔄 Auto-saved inspection report with ${balloons.length} balloons`);
    } catch (error) {
      console.error('Auto-save failed:', error);
    }
  };

  // Complete the inspection
  const handleCompleteInspection = async () => {
    try {
      const updateData = {
        id: inspectionId,
        data: {
          status: 'completed',
          notes: generalRemarks
        }
      };
      console.log('🚀 Updating inspection with:', updateData);
      await updateInspection.mutateAsync(updateData);
      toast.success('Inspection report submitted and completed successfully! You can now approve or reject it.');
      router.push(`/projects/${projectId}/quality-control`);
    } catch (error) {
      console.error('Failed to complete inspection:', error);
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
    
    // Debug logging
    console.log('Save Report - Original status:', status);
    console.log('Save Report - isDraft:', isDraft);
    console.log('Save Report - Final status:', finalStatus);
    
    // Ensure status is one of the allowed values
    if (!validStatuses.includes(finalStatus)) {
      finalStatus = 'draft'; // Default to draft for invalid values
      console.warn(`Invalid status '${status}', defaulting to 'draft'`);
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
        inspectionDate,
        rawMaterial,
        inspectionBy,
        approvedBy: approvedBy || undefined,
        generalRemarks: generalRemarks || undefined,
        status: finalStatus
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
          sampleValues: row.samples ? row.samples.map(s => parseFloat(s) || 0) : Array(sampleCount).fill(0),
          remarks: row.remarks || undefined
        }))
      }
    };

    try {
      const savedReport = await saveInspectionReport.mutateAsync(reportData);
      
      // Update local status from the database response (not local state)
      if (savedReport?.finalInspectionReport?.status) {
        const newStatus = savedReport.finalInspectionReport.status;
        console.log('🔄 Updating status from API response:', newStatus);
        setStatus(newStatus);
        
        // Update timestamp
        const now = new Date().toLocaleString();
        setLastSavedTime(now);
        
        // Also trigger a small delay to ensure React has time to update
        setTimeout(() => {
          console.log('🔄 Status should now be visible in UI:', newStatus);
        }, 100);
        
        // Force a re-render by updating a state that affects UI
        if (!silent) {
          toast.success(`Inspection report ${isDraft ? 'saved as draft' : 'submitted'} successfully! Status: ${newStatus.toUpperCase()}`);
        }
      } else {
        console.warn('⚠️ No status returned from API response');
        if (!silent) {
          toast.success(`Inspection report ${isDraft ? 'saved as draft' : 'submitted'} successfully!`);
        }
      }
    } catch (error) {
      console.error('Error saving inspection report:', error);
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
      
      row.samples.forEach(sample => {
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
      const balloonData = [
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
      const inspectionData = [
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
        row.samples.forEach((sample, sampleIndex) => {
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
        const allSamplesValid = row.samples.every(sample => {
          const value = parseFloat(sample);
          return !isNaN(value) && value >= lowerLimit && value <= upperLimit;
        });
        
        const hasValues = row.samples.some(sample => sample.trim() !== '');
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
      console.error('Error generating comprehensive PDF:', error);
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
      console.error('Error clearing inspection data:', error);
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
    <div className="w-full max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-2 sm:py-4 space-y-3 sm:space-y-4">
      {/* Header with breadcrumb and navigation */}
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
      <Card>
        <CardHeader className="pb-2 sm:pb-3">
          <CardTitle className="text-base sm:text-lg">2D Technical Drawings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 sm:space-y-3 p-3 sm:p-6">
          {bomsLoading || bomItemsLoading ? (
            <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-border rounded-lg">
              <div className="animate-spin h-8 w-8 mb-3 text-muted-foreground">⟳</div>
              <p className="text-sm text-muted-foreground">Loading BOM items...</p>
            </div>
          ) : bomItems?.length > 0 ? (
            <div className="grid gap-3">
              {bomItems.map((bomItem: any, index: number) => (
                <div key={bomItem.id || index} className="border rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-3">
                    <h4 className="font-medium">{bomItem.partNumber || bomItem.name || `Item ${index + 1}`}</h4>
                    <Badge variant="secondary" className="text-xs">
                      {bomItem.itemType || 'Component'}
                    </Badge>
                  </div>
                  
                  <InlinePDFViewer 
                    bomItem={bomItem} 
                    onBalloonsChanged={setBalloons}
                    inspectionId={inspectionId}
                    onSaveToDatabaseSilently={saveToDatabaseSilently}
                    onTableDataExtracted={handleExtractedTableData}
                  />
                  
                  {/* Item Details */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 bg-muted rounded-lg mt-3">
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
                      <p className="text-sm font-mono">{bomItem.description || 'N/A'}</p>
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

      {/* Balloon Drawing Section */}
      <Card>
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
      <Card>
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
      <Card>
        <CardHeader className="pb-2 sm:pb-3 p-3 sm:p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3">
            <CardTitle className="text-base sm:text-lg">Inspection Table (Summary)</CardTitle>
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
        <CardContent>
          <div className="overflow-x-auto">
            <div className="space-y-3 min-w-max">
              {/* Table Header */}
              <div className={`grid gap-2 text-xs font-medium bg-muted p-2 rounded`} style={{gridTemplateColumns: `50px 120px 90px 70px 70px 80px repeat(${sampleCount}, 80px) 120px`}}>
              <div>Sl. No</div>
              <div>Specification</div>
              <div>Nominal (mm)</div>
              <div>+ Tol</div>
              <div>- Tol</div>
              <div>Method</div>
              {Array.from({length: sampleCount}, (_, i) => (
                <div key={i}>Sample {i + 1}</div>
              ))}
              <div>Remarks</div>
            </div>

              {/* Table Rows */}
              {inspectionRows.map((row, index) => (
                <div key={row.id} className="grid gap-2 items-center" style={{gridTemplateColumns: `50px 120px 90px 70px 70px 80px repeat(${sampleCount}, 80px) 120px`}}>
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
                {row.samples.map((sample, index) => (
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
                      
                      const allSamplesValid = row.samples.every(sample => {
                        const value = parseFloat(sample);
                        return !isNaN(value) && value >= lowerLimit && value <= upperLimit;
                      });
                      
                      const hasValues = row.samples.some(sample => sample.trim() !== '');
                      
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
                    className={`text-xs ${
                      status === 'release' ? 'bg-primary text-primary-foreground hover:bg-primary/80' : ''
                    }`}
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
          <div className={`flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2 rounded-md border text-xs sm:text-sm ${
            status === 'draft' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 
            status === 'release' ? 'bg-primary/10 border-primary/20 text-primary' : 
            status === 'rejected' ? 'bg-red-50 border-red-200 text-red-800' : 
            'bg-gray-50 border-gray-200 text-gray-600'
          }`}>
            <div className={`${
              status === 'draft' ? 'text-yellow-600' : 
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
              <span className="hidden sm:inline">Submit & Complete</span>
              <span className="sm:hidden">Submit</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}