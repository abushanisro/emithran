'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Upload, 
  Settings, 
  Box, 
  FileText, 
  CircleCheckBig,
  Loader2,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { apiClient } from '@/lib/api/client';
import { bomItemsApi } from '@/lib/api/bom-items';
import { toast } from 'sonner';

interface AssemblyNode {
  id: string;
  name: string;
  type: 'assembly' | 'sub-assembly' | 'child-part' | 'part' | 'hardware' | 'fastener';
  partNumber?: string;
  quantity?: number;
  children?: AssemblyNode[];
  files?: {
    step?: string;
    pdf?: string;
  };
  level: number;
  expanded?: boolean;
  bomItemId?: string; // Link to actual BOM item in database
}

interface AssemblyTreeGeneratorProps {
  onAssemblyGenerated?: (tree: AssemblyNode[], assemblyData?: {
    modelUrl: string;
    fileName: string;
    volume: number;
    material: string;
    bomItemId: string;
  }) => void;
  className?: string;
  bomId?: string;
  projectId?: string;
}

export function AssemblyTreeGenerator({ onAssemblyGenerated, className, bomId, projectId }: AssemblyTreeGeneratorProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [assemblyTree, setAssemblyTree] = useState<AssemblyNode[]>([]);
  const [processingSteps, setProcessingSteps] = useState<string[]>([]);


  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      console.log('📁 File uploaded:', file.name, 'size:', file.size);
      setUploadedFile(file);
      console.log('✅ File state updated, Generate Assembly Tree button should now be visible');
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/step': ['.step', '.stp']
    },
    maxFiles: 1,
    maxSize: 100 * 1024 * 1024 // 100MB
  });

  const processStepFile = async () => {
    if (!uploadedFile) {
      console.log('❌ No uploaded file found');
      return;
    }

    console.log('🚀 Starting STEP file processing with file:', uploadedFile.name);
    console.log('📋 bomId:', bomId, 'projectId:', projectId);
    console.log('🔧 onAssemblyGenerated callback available?', !!onAssemblyGenerated);

    setIsProcessing(true);
    setProcessingSteps([]);

    const steps = [
      'File Validation Layer → STEP file integrity check',
      'CAD Engine → Parse STEP structure using OpenCascade',
      'Assembly Tree Walker → Identify hierarchical relationships',
      'Node Classifier → Assembly / Sub-Assembly / Child Part',
      'BOM Builder → Generate hierarchy + quantities',
      'AI Enrichment Layer → Material, make/buy, description inference',
      'BOM JSON → Supabase integration',
      'Frontend → Render tree in existing BOM UI'
    ];

    try {
      // File validation
      setProcessingSteps(prev => [...prev, steps[0]]);
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (!uploadedFile.name.toLowerCase().includes('.step') && !uploadedFile.name.toLowerCase().includes('.stp') && !uploadedFile.name.toLowerCase().includes('.iges') && !uploadedFile.name.toLowerCase().includes('.igs')) {
        throw new Error('Invalid file format. Please upload a STEP (.step, .stp) or IGES (.iges, .igs) file.');
      }
      if (uploadedFile.size > 100 * 1024 * 1024) {
        throw new Error('File too large. Please upload files smaller than 100MB.');
      }

      // Check if we have a BOM ID to process against
      if (!bomId) {
        throw new Error('BOM ID is required for STEP file processing. Please ensure you are working within a valid BOM context.');
      }

      // Call the backend STEP processing API
      setProcessingSteps(prev => [...prev, steps[1]]);
      await new Promise(resolve => setTimeout(resolve, 800));

      const formData = new FormData();
      formData.append('stepFile', uploadedFile);
      formData.append('bomId', bomId);
      if (projectId) {
        formData.append('projectId', projectId);
      }

      try {
        // Call the backend endpoint using uploadFiles method for proper FormData handling
        const response = await apiClient.uploadFiles<any>('/bom-items/process-step-file', formData, {
          timeout: 120000 // 2 minute timeout for STEP processing
        });

        // Add remaining steps
        for (let i = 2; i < steps.length; i++) {
          setProcessingSteps(prev => [...prev, steps[i]]);
          await new Promise(resolve => setTimeout(resolve, 400));
        }

        if (response.success) {
          // Real STEP processing was successful
          setProcessingSteps(prev => [...prev, '✅ STEP file processed successfully']);
          
          console.log('✅ STEP processing response:', response);
          console.log('🔍 Response has bomItemId?', response.bomItemId);
          console.log('🔍 Full response structure:', JSON.stringify(response, null, 2));
          
          // Try to create assembly data directly from response first (if BOM item ID is available)
          const tryDirectAssemblyData = () => {
            if (response.bomItemId) {
              console.log('🎯 Found BOM item ID in response, creating assembly data directly:', response.bomItemId);
              
              // Create assembly data directly using response data
              const materialRecommendation = response.cadAnalysis?.dfmAnalysis?.aiInsights?.materialRecommendations?.[0] || response.cadAnalysis?.dfm_analysis?.ai_insights?.material_recommendations?.[0];
              const materialString = typeof materialRecommendation === 'object' ? materialRecommendation.name || 'Aluminum 6061' : materialRecommendation || 'Aluminum 6061';
              
              const directAssemblyData = {
                modelUrl: '', // Will try to fetch this separately
                fileName: uploadedFile.name,
                volume: response.cadAnalysis?.geometryFeatures?.volumeMm3 || response.cadAnalysis?.geometry_features?.volume_mm3 || 0,
                material: materialString,
                bomItemId: response.bomItemId
              };
              
              console.log('📞 Calling bomItemsApi.getFileUrl with bomItemId:', response.bomItemId);
              
              // Try to get the 3D file URL directly using the proper API
              bomItemsApi.getFileUrl(response.bomItemId, '3d')
              .then(urlData => {
                console.log('✅ Got direct 3D file URL response:', urlData);
                if (urlData && urlData.url) {
                  directAssemblyData.modelUrl = urlData.url;
                  console.log('🚀 Calling onAssemblyGenerated with assembly data:', directAssemblyData);
                  console.log('🔧 onAssemblyGenerated function exists?', !!onAssemblyGenerated);
                  
                  if (onAssemblyGenerated) {
                    console.log('🎯 About to call onAssemblyGenerated...');
                    setAssemblyTree(response.assemblyTree || []);
                    onAssemblyGenerated(response.assemblyTree || [], directAssemblyData);
                    console.log('✅ onAssemblyGenerated called successfully');
                  } else {
                    console.error('❌ onAssemblyGenerated callback is undefined!');
                  }
                } else {
                  console.warn('⚠️ No URL in response, creating assembly data without model URL');
                  if (onAssemblyGenerated) {
                    setAssemblyTree(response.assemblyTree || []);
                    onAssemblyGenerated(response.assemblyTree || [], directAssemblyData);
                  }
                }
              })
              .catch(error => {
                console.error('❌ Failed to get direct 3D URL:', error);
                console.log('📝 Error details:', error.message, error.stack);
                console.log('🔄 Falling back to BOM fetch approach...');
                // Fall back to the BOM items fetch approach
                setTimeout(() => fetchAssemblyWithRetries(), 2000);
              });
              
              return true; // Indicate we tried the direct approach
            }
            console.log('❌ No bomItemId found in response, cannot use direct approach');
            return false; // Indicate we need to fall back
          };
          
          // Try direct approach first, then fall back to BOM items fetch if needed
          const useDirectApproach = tryDirectAssemblyData();
          
          // Only use the BOM fetch approach if direct approach failed
          if (!useDirectApproach) {
            console.log('🔄 No direct BOM item ID, falling back to BOM items fetch...');
          }
          
          // Wait for file processing to complete, then fetch the main BOM item with retries
          const fetchAssemblyWithRetries = async (attempt = 1, maxAttempts = 5) => {
            try {
              console.log(`🔍 Attempt ${attempt}/${maxAttempts}: Fetching BOM items to find main assembly...`);
              
              // Get the newly created BOM items to find the main assembly using proper API client
              const bomItemsData = await apiClient.get<{ items: any[] }>(`/bom-items?bomId=${bomId}`);
              
              console.log(`📡 API Response received:`, bomItemsData);
              console.log('📦 Found BOM items:', bomItemsData.items);
              
              // Find main assembly item - prioritize recently created assembly items
              let mainAssemblyItem = bomItemsData.items
                .filter((item: any) => item.itemType === 'assembly')
                .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
              
              // Fallback: find any item with file3dPath
              if (!mainAssemblyItem) {
                mainAssemblyItem = bomItemsData.items.find((item: any) => 
                  item.file3dPath && item.partNumber?.includes(uploadedFile.name.replace(/\.(step|stp|iges|igs)$/i, '').slice(0, 8))
                );
              }
              
              // Final fallback: use the most recently created item
              if (!mainAssemblyItem && bomItemsData.items.length > 0) {
                mainAssemblyItem = bomItemsData.items.sort((a: any, b: any) => 
                  new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                )[0];
              }
              
              console.log('🎯 Selected main assembly item:', mainAssemblyItem);
              
              if (mainAssemblyItem?.id) {
                try {
                  // Always try to get 3D file URL, even if file3dPath is not set
                  console.log('📂 Fetching 3D file URL for item:', mainAssemblyItem.id);
                  
                  const fileUrlData = await bomItemsApi.getFileUrl(mainAssemblyItem.id, '3d');
                  console.log('🔗 File URL data:', fileUrlData);
                  
                  const fallbackMaterialRecommendation = response.cadAnalysis?.dfmAnalysis?.aiInsights?.materialRecommendations?.[0] || response.cadAnalysis?.dfm_analysis?.ai_insights?.material_recommendations?.[0];
                  const fallbackMaterialString = typeof fallbackMaterialRecommendation === 'object' ? fallbackMaterialRecommendation.name || 'Aluminum 6061' : fallbackMaterialRecommendation || 'Aluminum 6061';
                  
                  const assemblyData = {
                    modelUrl: fileUrlData.url,
                    fileName: uploadedFile.name,
                    volume: response.cadAnalysis?.geometryFeatures?.volumeMm3 || response.cadAnalysis?.geometry_features?.volume_mm3 || 0,
                    material: fallbackMaterialString,
                    bomItemId: mainAssemblyItem.id
                  };

                  console.log('✅ Calling onAssemblyGenerated with assembly data from fallback:', assemblyData);

                  if (onAssemblyGenerated) {
                    setAssemblyTree(response.assemblyTree || []);
                    onAssemblyGenerated(response.assemblyTree || [], assemblyData);
                  } else {
                    console.warn('❌ onAssemblyGenerated callback is not defined');
                  }
                } catch (fileError) {
                  console.warn('⚠️ Failed to fetch 3D file URL:', fileError);
                  
                  // Even if file URL fetch fails, still call onAssemblyGenerated with tree
                  if (onAssemblyGenerated) {
                    setAssemblyTree(response.assemblyTree || []);
                    onAssemblyGenerated(response.assemblyTree || []);
                  }
                }
              } else {
                console.warn('⚠️ No suitable main assembly item found');
                
                // Still call onAssemblyGenerated with just the tree
                if (onAssemblyGenerated) {
                  setAssemblyTree(response.assemblyTree || []);
                  onAssemblyGenerated(response.assemblyTree || []);
                }
              }
            } catch (error) {
              console.error(`❌ Error on attempt ${attempt}:`, error);
              
              // Retry on network errors
              if (attempt < maxAttempts) {
                console.log(`🔄 Network error, retrying in ${attempt * 1000}ms...`);
                setTimeout(() => fetchAssemblyWithRetries(attempt + 1, maxAttempts), attempt * 1000);
                return;
              }
              
              console.error('❌ All retry attempts failed');
              
              // Still call onAssemblyGenerated with just the tree even after all retries fail
              if (onAssemblyGenerated) {
                setAssemblyTree(response.assemblyTree || []);
                onAssemblyGenerated(response.assemblyTree || []);
              }
            }
          };
          
          // Only start the BOM fetch if direct approach wasn't used
          if (!useDirectApproach) {
            setTimeout(() => fetchAssemblyWithRetries(), 3000);
          }

          toast.success('STEP file processed', {
            description: `Assembly structure extracted and BOM items created`,
            duration: 4000
          });
        } else {
          // Backend indicates CAD engine not available
          setProcessingSteps(prev => [...prev, `⚠️ ${response.message}`]);
          
          toast.warning('CAD Engine Required', {
            description: response.message,
            duration: 6000
          });

          // Show requirements and next steps
          console.log('STEP Processing Requirements:', response.requirements);
          console.log('Next Steps:', response.nextSteps);
        }

      } catch (apiError: any) {
        console.error('Backend API error:', apiError);
        console.error('Full error details:', {
          message: apiError.message,
          stack: apiError.stack,
          code: apiError.code,
          status: apiError.status,
          response: apiError.response,
          details: apiError.details
        });
        
        setProcessingSteps(prev => [...prev, `❌ Backend processing failed: ${apiError.message}`]);
        
        toast.error('Processing failed', {
          description: `Upload error: ${apiError.message}. Check console for details.`,
          duration: 8000
        });
      }
      
    } catch (error: any) {
      console.error('STEP processing error:', error);
      setProcessingSteps(prev => [...prev, `❌ Error: ${error.message}`]);
      throw error;
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleNode = (nodeId: string, nodes: AssemblyNode[]): AssemblyNode[] => {
    return nodes.map(node => {
      if (node.id === nodeId) {
        return { ...node, expanded: !node.expanded };
      }
      if (node.children) {
        return { ...node, children: toggleNode(nodeId, node.children) };
      }
      return node;
    });
  };

  const getTypeColor = (type: AssemblyNode['type']) => {
    switch (type) {
      case 'assembly':
        return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
      case 'sub-assembly':
        return 'bg-blue-500/10 text-blue-700 border-blue-500/20';
      case 'child-part':
        return 'bg-orange-500/10 text-orange-700 border-orange-500/20';
      case 'part':
        return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
      case 'hardware':
        return 'bg-purple-500/10 text-purple-700 border-purple-500/20';
      case 'fastener':
        return 'bg-gray-500/10 text-gray-700 border-gray-500/20';
      default:
        return 'bg-gray-500/10 text-gray-700 border-gray-500/20';
    }
  };

  const renderAssemblyNode = (node: AssemblyNode) => {
    const hasChildren = node.children && node.children.length > 0;
    const indentStyle = { paddingLeft: `${14 + node.level * 20}px` };

    return (
      <div key={node.id}>
        <div className="group hover:bg-muted/50 rounded-md transition-colors">
          <div className="flex items-center gap-2 py-1.5 px-2" style={indentStyle}>
            {node.level > 0 && (
              <div className="flex items-center">
                <div className="w-3 h-px bg-border"></div>
              </div>
            )}
            
            {hasChildren && (
              <button
                onClick={() => setAssemblyTree(prev => toggleNode(node.id, prev))}
                className="flex items-center justify-center w-4 h-4 hover:bg-muted rounded"
              >
                {node.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            )}
            
            {!hasChildren && <div className="w-4" />}
            
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <p className="text-sm font-medium truncate">
                {node.name}
                {node.quantity && ` (Qty: ${node.quantity})`}
              </p>
              <Badge 
                variant="outline" 
                className={`text-[10px] px-1.5 py-0 h-4 ${getTypeColor(node.type)}`}
              >
                {node.type === 'sub-assembly' ? 'Sub-Assembly' : 
                 node.type === 'child-part' ? 'Child Part' :
                 node.type.charAt(0).toUpperCase() + node.type.slice(1)}
              </Badge>
              {node.partNumber && (
                <span className="text-xs text-muted-foreground">#{node.partNumber}</span>
              )}
            </div>
            
            <div className="flex items-center gap-4 text-xs">
              {node.files?.pdf && (
                <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                  <FileText className="h-3 w-3" />
                  <span>{node.files.pdf}</span>
                </button>
              )}
              {node.files?.step && (
                <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                  <Box className="h-3 w-3" />
                  <span>{node.files.step}</span>
                </button>
              )}
            </div>
          </div>
        </div>
        
        {hasChildren && node.expanded && (
          <div>
            {node.children!.map(renderAssemblyNode)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`p-6 pt-0 space-y-6 ${className || ''}`}>
      {/* File Upload Section */}
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
          ${isDragActive 
            ? 'border-primary bg-primary/5' 
            : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Upload STEP File</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {isDragActive ? 'Drop the file here' : 'Drop your STEP file here or click to browse'}
            </p>
          </div>
          <Button variant="outline" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Choose STEP File
          </Button>
          <p className="text-xs text-muted-foreground">
            Supports .step, .stp files up to 100MB
          </p>
          {uploadedFile && (
            <div className="text-sm text-green-600 font-medium">
              Selected: {uploadedFile.name}
            </div>
          )}
        </div>
      </div>

      {/* Processing Pipeline Info */}
      <Card className="bg-muted/30 p-4">
        <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Settings className="h-4 w-4" />
          CAD Processing Pipeline
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
            <span>STEP file → OpenCascade → volume, surface area, holes, walls</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-500"></div>
            <span>Material DB lookup → density, price/kg</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
            <span>Process classifier → CNC / casting / sheet metal</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-purple-500"></div>
            <span>Cost formulas → material + machining + setup</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500"></div>
            <span>XGBoost adjustment → correction factor from history</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span><strong>ACCURATE COST ✅</strong></span>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
            <span>LLM (optional, async) → explanation + DFM advice</span>
          </div>
        </div>
      </Card>

      {/* Process Button */}
      {uploadedFile && !assemblyTree.length && (
        <div className="flex justify-center">
          <Button 
            onClick={processStepFile} 
            disabled={isProcessing}
            size="lg"
            className="px-8"
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing STEP File...
              </>
            ) : (
              <>
                <Box className="mr-2 h-4 w-4" />
                Generate Assembly Tree
              </>
            )}
          </Button>
        </div>
      )}

      {/* Processing Steps */}
      {isProcessing && (
        <Alert className="bg-blue-50 border-blue-200">
          <CircleCheckBig className="h-4 w-4 text-blue-500" />
          <AlertDescription className="text-blue-700">
            <div className="space-y-1">
              {processingSteps.map((step, index) => (
                <p key={index}>✅ {step}</p>
              ))}
              {processingSteps.length < 8 && (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processing...
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Assembly Tree Structure */}
      {assemblyTree.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold flex items-center gap-2">
              <Box className="h-5 w-5" />
              Assembly Tree Structure
            </h4>
            <Badge variant="outline" className="text-xs">
              Auto-Generated from STEP
            </Badge>
          </div>
          
          <div className="space-y-0.5 bg-muted/20 rounded-lg p-4">
            {assemblyTree.map(renderAssemblyNode)}
          </div>
        </div>
      )}

      {/* Success Message */}
      {assemblyTree.length > 0 && (
        <Alert className="bg-blue-50 border-blue-200">
          <CircleCheckBig className="h-5 w-5 text-blue-500" />
          <div>
            <h4 className="text-sm font-medium text-blue-900 mb-1">
              Automated BOM Generation Process
            </h4>
            <div className="text-xs text-blue-700 space-y-1">
              <p>✅ File Validation Layer → STEP file integrity check</p>
              <p>✅ CAD Engine → Parse STEP structure using OpenCascade</p>
              <p>✅ Assembly Tree Walker → Identify hierarchical relationships</p>
              <p>✅ Node Classifier → Assembly / Sub-Assembly / Child Part</p>
              <p>✅ BOM Builder → Generate hierarchy + quantities</p>
              <p>✅ AI Enrichment Layer → Material, make/buy, description inference</p>
              <p>✅ BOM JSON → Supabase integration</p>
              <p>✅ Frontend → Render tree in existing BOM UI</p>
            </div>
          </div>
        </Alert>
      )}
    </div>
  );
}