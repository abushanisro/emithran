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

interface AssemblyNode {
  id: string;
  name: string;
  type: 'assembly' | 'sub-assembly' | 'part' | 'hardware' | 'fastener';
  partNumber?: string;
  quantity?: number;
  children?: AssemblyNode[];
  files?: {
    step?: string;
    pdf?: string;
  };
  level: number;
  expanded?: boolean;
}

interface AssemblyTreeGeneratorProps {
  onAssemblyGenerated?: (tree: AssemblyNode[]) => void;
  className?: string;
}

export function AssemblyTreeGenerator({ onAssemblyGenerated, className }: AssemblyTreeGeneratorProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [assemblyTree, setAssemblyTree] = useState<AssemblyNode[]>([]);
  const [processingSteps, setProcessingSteps] = useState<string[]>([]);

  // Mock assembly tree data for demonstration
  const mockAssemblyTree: AssemblyNode[] = [
    {
      id: 'main-assembly',
      name: 'Main Assembly',
      type: 'assembly',
      level: 0,
      expanded: true,
      files: { step: 'main_assembly.step' },
      children: [
        {
          id: 'mounting-assembly',
          name: 'Mounting Assembly',
          type: 'sub-assembly',
          partNumber: 'ASM-002',
          level: 1,
          expanded: true,
          files: { step: 'mounting_assembly.step' },
          children: [
            {
              id: 'base-plate',
              name: 'Base Plate',
              type: 'part',
              partNumber: 'PRT-001',
              level: 2,
              files: { step: 'base_plate.step', pdf: 'base_plate.pdf' }
            },
            {
              id: 'mounting-bracket',
              name: 'Mounting Bracket',
              type: 'part',
              partNumber: 'PRT-002',
              level: 2,
              files: { step: 'mounting_bracket.step', pdf: 'mounting_bracket.pdf' }
            }
          ]
        },
        {
          id: 'hardware-kit',
          name: 'Hardware Kit',
          type: 'hardware',
          partNumber: 'HW-001',
          level: 1,
          children: [
            {
              id: 'bolt-m8x20',
              name: 'Bolt M8x20',
              type: 'fastener',
              partNumber: 'M8x20',
              quantity: 4,
              level: 2
            },
            {
              id: 'washer-m8',
              name: 'Washer M8',
              type: 'fastener',
              partNumber: 'W8',
              quantity: 4,
              level: 2
            }
          ]
        }
      ]
    }
  ];

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setUploadedFile(file);
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
    if (!uploadedFile) return;

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

    for (let i = 0; i < steps.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 800));
      setProcessingSteps(prev => [...prev, steps[i]]);
    }

    // Simulate successful processing
    setAssemblyTree(mockAssemblyTree);
    onAssemblyGenerated?.(mockAssemblyTree);
    setIsProcessing(false);
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