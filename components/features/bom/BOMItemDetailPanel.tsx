'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { X, Download, FileText, Maximize2, Upload, Loader2, Box } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { apiClient } from '@/lib/api/client';
import { toast } from 'sonner';
import { ModelViewer } from '@/components/ui/model-viewer';

interface BOMItemDetailPanelProps {
  item: BOMItem | null;
  onClose: () => void;
  onUpdate?: () => void;
  preferredView?: '2d' | '3d';
}

export function BOMItemDetailPanel({ item, onClose, onUpdate, preferredView = '3d' }: BOMItemDetailPanelProps) {
  const [file2dUrl, setFile2dUrl] = useState<string | null>(null);
  const [file3dUrl, setFile3dUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageView, setImageView] = useState<'fit' | 'full'>('fit');
  const [selectedFile2d, setSelectedFile2d] = useState<File | null>(null);
  const [selectedFile3d, setSelectedFile3d] = useState<File | null>(null);
  const file2dInputRef = useRef<HTMLInputElement>(null);
  const file3dInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!item) {
      setFile2dUrl(null);
      setFile3dUrl(null);
      setSelectedFile2d(null);
      setSelectedFile3d(null);
      return;
    }

    const loadFileUrls = async () => {
      setLoading(true);
      try {
        if (item.file2dPath) {
          const response = await apiClient.get<{ url: string }>(`/bom-items/${item.id}/file-url/2d`);
          if (response) {
            setFile2dUrl(response.url);
          }
        }
        if (item.file3dPath) {
          const response = await apiClient.get<{ url: string }>(`/bom-items/${item.id}/file-url/3d`);
          if (response) {
            setFile3dUrl(response.url);
          }
        }
      } catch (error: any) {
        console.error('Failed to load file URLs:', error);
        let errorMessage = 'Failed to load technical files.';
        if (error?.message) {
          if (error.message.includes('permission')) {
            errorMessage = 'Unable to access files: Permission denied.';
          } else if (error.message.includes('network')) {
            errorMessage = 'Unable to load files: Network connection failed.';
          } else if (error.message.includes('not found')) {
            errorMessage = 'Files not found on server.';
          }
        }
        // Don't show toast for file loading errors in detail panel as it's not critical
        // Files will just show as unavailable
      } finally {
        setLoading(false);
      }
    };

    loadFileUrls();
  }, [item]);

  const handleFileUpload = async () => {
    if (!item || (!selectedFile2d && !selectedFile3d)) {
      toast.error('Please select at least one file to upload. Choose a 2D drawing (PDF, PNG, JPG) or 3D model (STEP, STL, OBJ).');
      return;
    }

    // Validate file types and sizes
    if (selectedFile2d) {
      const validFile2dTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
      if (!validFile2dTypes.includes(selectedFile2d.type)) {
        toast.error('Invalid 2D file type. Please select a PDF, PNG, or JPG file for technical drawings.');
        return;
      }
      if (selectedFile2d.size > 50 * 1024 * 1024) { // 50MB limit
        toast.error('2D file is too large. Please use files smaller than 50MB.');
        return;
      }
    }

    if (selectedFile3d) {
      const valid3dExtensions = ['.stp', '.step', '.stl', '.obj', '.iges', '.igs'];
      const fileExtension = selectedFile3d.name.toLowerCase().substring(selectedFile3d.name.lastIndexOf('.'));
      if (!valid3dExtensions.includes(fileExtension)) {
        toast.error('Invalid 3D file type. Please select a STEP, STL, OBJ, or IGES file for 3D models.');
        return;
      }
      if (selectedFile3d.size > 100 * 1024 * 1024) { // 100MB limit
        toast.error('3D file is too large. Please use files smaller than 100MB.');
        return;
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      if (selectedFile2d) {
        formData.append('file2d', selectedFile2d);
      }
      if (selectedFile3d) {
        formData.append('file3d', selectedFile3d);
      }

      const updatedItem = await apiClient.uploadFiles<BOMItem>(`/bom-items/${item.id}/upload-files`, formData);

      const uploadedFiles = [];
      if (uploaded2d) uploadedFiles.push('2D drawing');
      if (uploaded3d) uploadedFiles.push('3D model');
      toast.success(`${uploadedFiles.join(' and ')} uploaded successfully for ${item.name}. Files are now available for viewing and download.`);

      // Capture which files were uploaded before clearing state
      const uploaded2d = selectedFile2d;
      const uploaded3d = selectedFile3d;

      setSelectedFile2d(null);
      setSelectedFile3d(null);

      // Clear file inputs
      if (file2dInputRef.current) file2dInputRef.current.value = '';
      if (file3dInputRef.current) file3dInputRef.current.value = '';

      // Refresh the item data in parent component
      onUpdate?.();

      // Reload file URLs for newly uploaded files
      setTimeout(async () => {
        try {
          if (uploaded2d && updatedItem.file2dPath) {
            const response2d = await apiClient.get<{ url: string }>(`/bom-items/${item.id}/file-url/2d`);
            if (response2d) {
              setFile2dUrl(response2d.url);
            }
          }
          if (uploaded3d && updatedItem.file3dPath) {
            const response3d = await apiClient.get<{ url: string }>(`/bom-items/${item.id}/file-url/3d`);
            if (response3d) {
              setFile3dUrl(response3d.url);
            }
          }
        } catch (error: any) {
          console.error('Failed to load file URLs after upload:', error);
          // Don't show error toast for post-upload file loading as files were uploaded successfully
        }
      }, 500);
    } catch (error: any) {
      console.error('Upload error:', error);
      
      let errorMessage = 'Failed to upload files. Please try again.';
      if (error?.message) {
        if (error.message.includes('size')) {
          errorMessage = 'File upload failed: One or more files exceed the size limit. Use smaller files (2D: <50MB, 3D: <100MB).';
        } else if (error.message.includes('format') || error.message.includes('type')) {
          errorMessage = 'File upload failed: Unsupported file format. Use PDF/PNG/JPG for 2D drawings and STEP/STL/OBJ for 3D models.';
        } else if (error.message.includes('network')) {
          errorMessage = 'File upload failed: Network connection error. Please check your internet and try again.';
        } else if (error.message.includes('permission')) {
          errorMessage = 'File upload failed: You do not have permission to upload files for this item.';
        } else if (error.message.includes('storage')) {
          errorMessage = 'File upload failed: Storage quota exceeded. Please contact your administrator.';
        } else {
          errorMessage = `File upload failed: ${error.message}`;
        }
      }
      
      toast.error(errorMessage, { duration: 8000 });
    } finally {
      setUploading(false);
    }
  };

  if (!item) return null;

  const lowerPath = item.file2dPath?.toLowerCase();
  const isImage2d = lowerPath && (
    lowerPath.endsWith('.png') ||
    lowerPath.endsWith('.jpg') ||
    lowerPath.endsWith('.jpeg')
  );

  const isPdf2d = lowerPath && lowerPath.endsWith('.pdf');

  return (
    <div className="fixed right-0 top-0 h-full w-full md:w-[90vw] lg:w-[80vw] xl:w-[75vw] bg-background border-l shadow-2xl z-50 overflow-y-auto">
      <Card className="h-full rounded-none border-0">
        <CardHeader className="border-b sticky top-0 bg-background z-10">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <CardTitle className="text-xl">{item.name}</CardTitle>
                {(item.file3dPath || item.file2dPath) && (
                  <Badge
                    variant={
                      (preferredView === '3d' && item.file3dPath) || (!item.file2dPath && item.file3dPath)
                        ? 'default'
                        : 'secondary'
                    }
                    className="text-xs"
                  >
                    {(preferredView === '3d' && item.file3dPath) || (!item.file2dPath && item.file3dPath) ? (
                      <>
                        <Box className="h-3 w-3 mr-1" />
                        3D Model
                      </>
                    ) : (
                      <>
                        <FileText className="h-3 w-3 mr-1" />
                        2D Drawing
                      </>
                    )}
                  </Badge>
                )}
              </div>
              {item.partNumber && (
                <p className="text-sm text-muted-foreground">Part #: {item.partNumber}</p>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          <div className="mt-6">

{/* Files Section - Respects Preferred View */}
            {(item.file2dPath || item.file3dPath) && (
              <div className="border-t pt-6">
                {/* Show based on preferredView, or fallback logic */}
                {(preferredView === '3d' && item.file3dPath) || (!item.file2dPath && item.file3dPath) ? (
                  <div className="space-y-4">
                    {loading && (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      </div>
                    )}

{!loading && file3dUrl && (
                      <ModelViewer
                        key={file3dUrl}
                        fileUrl={file3dUrl}
                        fileName={item.file3dPath?.split('/').pop() || 'model'}
                        fileType={item.file3dPath?.split('.').pop() || 'stl'}
                        bomItemId={item.id}
                      />
                    )}

                    {!loading && !file3dUrl && (
                      <div className="text-center py-12 text-muted-foreground">
                        <p className="text-sm">No 3D model available</p>
                      </div>
                    )}
                  </div>
                ) : item.file2dPath ? (
                  <div className="space-y-4">
                    {loading && (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      </div>
                    )}

                    {!loading && file2dUrl && isImage2d && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-muted-foreground">
                            {item.file2dPath?.split('/').pop()}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setImageView(imageView === 'fit' ? 'full' : 'fit')}
                          >
                            <Maximize2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className={`border rounded-lg overflow-hidden bg-muted/30 ${imageView === 'fit' ? 'max-h-[400px]' : ''}`}>
                          <img
                            src={file2dUrl}
                            alt={item.name}
                            className={`w-full ${imageView === 'fit' ? 'object-contain max-h-[400px]' : 'object-cover'}`}
                          />
                        </div>
                        <Button variant="outline" className="w-full" asChild>
                          <a href={file2dUrl} download target="_blank" rel="noopener noreferrer">
                            <Download className="h-4 w-4 mr-2" />
                            Download Image
                          </a>
                        </Button>
                      </div>
                    )}

                    {!loading && file2dUrl && isPdf2d && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          {item.file2dPath?.split('/').pop()}
                        </p>
                        <div className="border rounded-lg overflow-hidden" style={{ height: '800px' }}>
                          <iframe
                            src={file2dUrl}
                            className="w-full h-full"
                            title="PDF Preview"
                          />
                        </div>
                        <Button variant="outline" className="w-full" asChild>
                          <a href={file2dUrl} download target="_blank" rel="noopener noreferrer">
                            <Download className="h-4 w-4 mr-2" />
                            Download PDF
                          </a>
                        </Button>
                      </div>
                    )}

                    {!loading && file2dUrl && !isImage2d && !isPdf2d && (
                      <div className="text-center py-8">
                        <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground mb-4">
                          {item.file2dPath?.split('/').pop()}
                        </p>
                        <Button variant="outline" asChild>
                          <a href={file2dUrl} download target="_blank" rel="noopener noreferrer">
                            <Download className="h-4 w-4 mr-2" />
                            Download File
                          </a>
                        </Button>
                      </div>
                    )}

                    {!loading && !file2dUrl && (
                      <div className="text-center py-12 text-muted-foreground">
                        <p className="text-sm">No 2D drawing available</p>
                      </div>
                    )}
                  </div>
                ) : null}

                {/* Add Missing Files */}
                {(!item.file2dPath || !item.file3dPath) && (
                  <div className="mt-6 border rounded-lg p-4 bg-muted/30">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Upload className="h-4 w-4" />
                      Add {!item.file2dPath && !item.file3dPath ? 'Files' : !item.file2dPath ? '2D Drawing' : '3D Model'}
                    </h4>
                    <div className="space-y-3">
                      {!item.file2dPath && (
                        <div className="space-y-2">
                          <Label htmlFor="add-2d" className="text-xs">
                            2D Drawing (PDF, PNG, JPG)
                          </Label>
                          <Input
                            id="add-2d"
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                            onChange={(e) => setSelectedFile2d(e.target.files?.[0] || null)}
                            disabled={uploading}
                            className="text-sm"
                          />
                          {selectedFile2d && (
                            <p className="text-xs text-muted-foreground">
                              {selectedFile2d.name} ({(selectedFile2d.size / 1024).toFixed(1)} KB)
                            </p>
                          )}
                        </div>
                      )}
                      {!item.file3dPath && (
                        <div className="space-y-2">
                          <Label htmlFor="add-3d" className="text-xs">
                            3D Model (STEP, STL, OBJ)
                          </Label>
                          <Input
                            id="add-3d"
                            type="file"
                            accept=".stp,.step,.stl,.obj,.iges,.igs"
                            onChange={(e) => setSelectedFile3d(e.target.files?.[0] || null)}
                            disabled={uploading}
                            className="text-sm"
                          />
                          {selectedFile3d && (
                            <p className="text-xs text-muted-foreground">
                              {selectedFile3d.name} ({(selectedFile3d.size / 1024).toFixed(1)} KB)
                            </p>
                          )}
                        </div>
                      )}
                      <Button
                        onClick={handleFileUpload}
                        disabled={uploading || (!selectedFile2d && !selectedFile3d)}
                        size="sm"
                        className="w-full"
                      >
                        {uploading ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Uploading...
                          </>
                        ) : (
                          <>
                            <Upload className="h-4 w-4 mr-2" />
                            Upload
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!item.file2dPath && !item.file3dPath && (
              <div className="border rounded-lg p-6">
                <div className="text-center mb-6">
                  <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground mb-1">No technical files attached</p>
                  <p className="text-xs text-muted-foreground">Upload 2D drawings and 3D models</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="upload-2d" className="text-sm font-medium">
                      2D Drawing (PDF, PNG, JPG)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        ref={file2dInputRef}
                        id="upload-2d"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                        onChange={(e) => setSelectedFile2d(e.target.files?.[0] || null)}
                        disabled={uploading}
                        className="flex-1"
                      />
                    </div>
                    {selectedFile2d && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {selectedFile2d.name} ({(selectedFile2d.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="upload-3d" className="text-sm font-medium">
                      3D Model (STEP, STL, OBJ)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        ref={file3dInputRef}
                        id="upload-3d"
                        type="file"
                        accept=".stp,.step,.stl,.obj,.iges,.igs"
                        onChange={(e) => setSelectedFile3d(e.target.files?.[0] || null)}
                        disabled={uploading}
                        className="flex-1"
                      />
                    </div>
                    {selectedFile3d && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {selectedFile3d.name} ({(selectedFile3d.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={handleFileUpload}
                    disabled={uploading || (!selectedFile2d && !selectedFile3d)}
                    className="w-full"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Files
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
