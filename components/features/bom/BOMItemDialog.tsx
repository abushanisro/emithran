'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { 
  FileText, 
  Package, 
  AlertTriangle, 
  CheckCircle, 
  Info, 
  XCircle, 
  Loader2, 
  HelpCircle,
  Clock,
  Plus,
  ChevronDown,
  Check,
  ChevronsUpDown
} from 'lucide-react';
import { toast } from 'sonner';
import { createBOMItem, updateBOMItem } from '@/lib/api/hooks/useBOMItems';
import { BOMItemType, ITEM_TYPE_LABELS } from '@/lib/types/bom.types';
import { apiClient } from '@/lib/api/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useRawMaterials } from '@/lib/api/hooks/useRawMaterials';

// Enhanced error handling types for BOM management
type EnhancedBOMError = {
  category: 'validation' | 'duplication' | 'hierarchy' | 'fileupload' | 'network' | 'permission' | 'business' | 'data';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userMessage: string;
  technicalMessage?: string;
  suggestion: string;
  actionable: boolean;
  recoverable: boolean;
  helpUrl?: string;
  affectedFields?: string[];
};

/**
 * Categorize BOM-specific errors with manufacturing context
 */
function categorizeBOMError(error: any): EnhancedBOMError {
  const errorMessage = error?.message?.toLowerCase() || '';
  const statusCode = error?.status || error?.code;
  
  // Validation errors (High severity - prevents BOM creation)
  if (errorMessage.includes('validation') || errorMessage.includes('required') || statusCode === 400) {
    return {
      category: 'validation',
      severity: 'high',
      userMessage: 'Invalid BOM Data',
      technicalMessage: error?.message,
      suggestion: 'Please review all required fields and ensure values are within acceptable ranges',
      actionable: true,
      recoverable: true,
      helpUrl: '/help/bom-validation',
      affectedFields: error?.fields || []
    };
  }
  
  // Duplication errors (Medium severity - business rule violation)
  if (errorMessage.includes('duplicate') || errorMessage.includes('unique') || statusCode === 409) {
    return {
      category: 'duplication',
      severity: 'medium',
      userMessage: 'Duplicate Item Detected',
      suggestion: 'Use a different part number or update the existing item instead',
      actionable: true,
      recoverable: true,
      helpUrl: '/help/part-numbering'
    };
  }
  
  // Hierarchy errors (High severity - affects BOM structure)
  if (errorMessage.includes('parent') || errorMessage.includes('hierarchy') || errorMessage.includes('circular')) {
    return {
      category: 'hierarchy',
      severity: 'high',
      userMessage: 'Invalid BOM Structure',
      suggestion: 'Check parent-child relationships and avoid circular dependencies',
      actionable: true,
      recoverable: true
    };
  }
  
  // File upload errors (Low to medium severity)
  if (errorMessage.includes('file') || errorMessage.includes('upload') || errorMessage.includes('size') || errorMessage.includes('format')) {
    const severity = errorMessage.includes('size') || errorMessage.includes('format') ? 'medium' : 'low';
    return {
      category: 'fileupload',
      severity,
      userMessage: 'File Upload Issue',
      suggestion: 'Check file size (max 10MB) and format (PDF, STEP, STL, images)',
      actionable: true,
      recoverable: true
    };
  }
  
  // Permission errors (Medium severity)
  if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || statusCode === 403) {
    return {
      category: 'permission',
      severity: 'medium',
      userMessage: 'Access Denied',
      suggestion: 'Contact your administrator for BOM editing permissions',
      actionable: false,
      recoverable: false
    };
  }
  
  // Network errors (Critical severity)
  if (errorMessage.includes('network') || errorMessage.includes('timeout') || statusCode >= 500) {
    return {
      category: 'network',
      severity: 'critical',
      userMessage: 'Connection Problem',
      suggestion: 'Check your internet connection and try again',
      actionable: true,
      recoverable: true
    };
  }
  
  // Business rule errors (Medium severity)
  if (errorMessage.includes('business') || errorMessage.includes('rule') || errorMessage.includes('constraint')) {
    return {
      category: 'business',
      severity: 'medium',
      userMessage: 'Business Rule Violation',
      suggestion: 'Review manufacturing constraints and BOM policies',
      actionable: true,
      recoverable: true
    };
  }
  
  // Data errors (Low severity)
  if (errorMessage.includes('not found') || statusCode === 404) {
    return {
      category: 'data',
      severity: 'low',
      userMessage: 'Data Not Found',
      suggestion: 'The item may have been deleted or moved. Please refresh and try again.',
      actionable: true,
      recoverable: false
    };
  }
  
  // Default error
  return {
    category: 'data',
    severity: 'medium',
    userMessage: 'Unexpected Error',
    technicalMessage: error?.message,
    suggestion: 'Please try again. If the problem persists, contact support.',
    actionable: true,
    recoverable: true
  };
}

interface BOMItemDialogProps {
  bomId: string;
  item?: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  parentItemId?: string | null;
  defaultItemType?: BOMItemType;
  getAutoParent?: (type: BOMItemType) => string | null;
}

export function BOMItemDialog({ bomId, item, open, onOpenChange, onSuccess, parentItemId, defaultItemType, getAutoParent }: BOMItemDialogProps) {
  const queryClient = useQueryClient();
  
  // State for material grade combobox
  const [materialGradeOpen, setMaterialGradeOpen] = useState(false);
  const [materialGradeSearch, setMaterialGradeSearch] = useState('');
  
  // Get raw materials for material grade dropdown (only ferrous and non-ferrous)
  const { data: rawMaterialsData, isLoading: isLoadingMaterials } = useRawMaterials({
    search: materialGradeSearch,
    limit: 100 // Limit for better performance with search
  });
  
  // Extract unique material grades (only ferrous and non-ferrous materials)
  const materialOptions = React.useMemo(() => {
    if (!rawMaterialsData?.items) return [];
    
    // Filter for only ferrous and non-ferrous materials
    const filteredMaterials = rawMaterialsData.items.filter(material => {
      const materialGroup = material.materialGroup?.toLowerCase() || '';
      const materialName = material.material?.toLowerCase() || '';
      
      // Exclude plastic and rubber materials
      const isPlastic = materialGroup.includes('plastic') || materialName.includes('plastic') || 
                       materialGroup.includes('polymer') || materialName.includes('polymer');
      const isRubber = materialGroup.includes('rubber') || materialName.includes('rubber') ||
                      materialGroup.includes('elastomer') || materialName.includes('elastomer');
      
      return !isPlastic && !isRubber && material.materialGrade && material.materialGrade.trim();
    });
    
    // Extract unique material grades
    const grades = filteredMaterials
      .map(material => material.materialGrade!.trim())
      .filter((grade, index, array) => array.indexOf(grade) === index)
      .sort();
      
    return grades;
  }, [rawMaterialsData]);
  const [loading, setLoading] = useState(false);
  const [autoParentId, setAutoParentId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState<{ file2d?: number; file3d?: number }>({});
  const [showHelp, setShowHelp] = useState<Record<string, boolean>>({});
  const [formData, setFormData] = useState({
    name: '',
    partNumber: '',
    description: '',
    itemType: defaultItemType || BOMItemType.ASSEMBLY,
    quantity: 1,
    annualVolume: 1000,
    unit: 'pcs',
    material: '',
    materialGrade: '',
    makeBuy: 'make' as 'make' | 'buy',
    unitCost: '',
    bomLevel: 'L0',
    weight: 0,
    maxLength: 0,
    maxWidth: 0,
    maxHeight: 0,
    surfaceArea: 0,
    file2d: null as File | null,
    file3d: null as File | null,
  });
  
  // Calculate form completion percentage
  const calculateCompletionPercentage = () => {
    const requiredFields = ['name', 'partNumber', 'quantity', 'annualVolume', 'itemType'];
    const optionalFields = ['description', 'materialGrade', 'weight'];
    
    let completed = 0;
    let total = requiredFields.length + optionalFields.length;
    
    // Required fields (weighted more)
    requiredFields.forEach(field => {
      if (formData[field as keyof typeof formData] && String(formData[field as keyof typeof formData]).trim()) {
        completed += 2;
      }
      total += 1; // Extra weight for required fields
    });
    
    // Optional fields
    optionalFields.forEach(field => {
      if (formData[field as keyof typeof formData] && String(formData[field as keyof typeof formData]).trim()) {
        completed += 1;
      }
    });
    
    return Math.round((completed / total) * 100);
  };
  
  // Real-time validation with debouncing
  const validationStatus = useMemo(() => {
    const errors: Record<string, string> = {};
    
    // Required field validation - Name is required
    if (!formData.name.trim()) {
      errors.name = 'Item name is required';
    } else if (formData.name.length < 3) {
      errors.name = 'Name must be at least 3 characters';
    } else if (formData.name.length > 100) {
      errors.name = 'Name must not exceed 100 characters';
    }
    
    // Required field validation - Part Number is required
    if (!formData.partNumber.trim()) {
      errors.partNumber = 'Part number is required';
    } else if (formData.partNumber.length < 2) {
      errors.partNumber = 'Part number must be at least 2 characters';
    } else if (formData.partNumber.length > 50) {
      errors.partNumber = 'Part number must not exceed 50 characters';
    }
    
    // Quantity validation
    if (formData.quantity <= 0) {
      errors.quantity = 'Quantity must be greater than 0';
    } else if (formData.quantity > 10000) {
      errors.quantity = 'Quantity seems unusually high. Please verify.';
    }
    
    // Annual volume validation
    if (formData.annualVolume <= 0) {
      errors.annualVolume = 'Annual volume must be greater than 0';
    } else if (formData.annualVolume > 10000000) {
      errors.annualVolume = 'Annual volume seems extremely high. Please verify.';
    }
    
    
    // Physical properties validation
    if (formData.weight && formData.weight < 0) {
      errors.weight = 'Weight cannot be negative';
    } else if (formData.weight && formData.weight > 10000) {
      errors.weight = 'Weight seems extremely high for a component';
    }
    
    if (formData.maxLength && formData.maxLength < 0) {
      errors.maxLength = 'Length cannot be negative';
    }
    if (formData.maxWidth && formData.maxWidth < 0) {
      errors.maxWidth = 'Width cannot be negative';
    }
    if (formData.maxHeight && formData.maxHeight < 0) {
      errors.maxHeight = 'Height cannot be negative';
    }
    if (formData.surfaceArea && formData.surfaceArea < 0) {
      errors.surfaceArea = 'Surface area cannot be negative';
    }
    
    // Unit cost validation for buy items
    const unitCostNum = parseFloat(formData.unitCost) || 0;
    if (formData.makeBuy === 'buy' && (!formData.unitCost || unitCostNum <= 0)) {
      errors.unitCost = 'Unit cost is required for purchased items';
    } else if (formData.makeBuy === 'buy' && unitCostNum > 1000000) {
      errors.unitCost = 'Unit cost seems extremely high. Please verify.';
    }
    
    // File size validation
    if (formData.file2d && formData.file2d.size > 10 * 1024 * 1024) { // 10MB limit
      errors.file2d = 'File size must be less than 10MB';
    }
    if (formData.file3d && formData.file3d.size > 25 * 1024 * 1024) { // 25MB limit for 3D files
      errors.file3d = 'File size must be less than 25MB';
    }
    
    return {
      errors,
      isValid: Object.keys(errors).length === 0,
      completionPercentage: calculateCompletionPercentage()
    };
  }, [formData]);
  
  // Update validation errors when form changes
  useEffect(() => {
    setValidationErrors(validationStatus.errors);
  }, [validationStatus.errors]);

  // Auto-assign parent and BOM level when item type changes
  useEffect(() => {
    if (!item && getAutoParent) {
      const autoParent = getAutoParent(formData.itemType);
      setAutoParentId(autoParent);
    }
    
    // Auto-assign BOM level based on item type
    let bomLevel = 'L0';
    switch (formData.itemType) {
      case BOMItemType.ASSEMBLY:
        bomLevel = 'L0';
        break;
      case BOMItemType.SUB_ASSEMBLY:
        bomLevel = 'L1';
        break;
      case BOMItemType.CHILD_PART:
        bomLevel = 'L2';
        break;
      default:
        bomLevel = 'L0';
    }
    
    // Update bomLevel only if it's different to avoid infinite loops
    if (formData.bomLevel !== bomLevel) {
      setFormData(prev => ({ ...prev, bomLevel }));
    }
  }, [formData.itemType, getAutoParent, item, formData.bomLevel]);

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        partNumber: item.partNumber || '',
        description: item.description || '',
        itemType: item.itemType || BOMItemType.ASSEMBLY,
        quantity: item.quantity || 1,
        annualVolume: item.annualVolume || 1000,
        unit: item.unit || 'pcs',
        material: item.material || '',
        materialGrade: item.materialGrade || '',
        makeBuy: item.makeBuy || 'make',
        unitCost: item.unitCost ? item.unitCost.toString() : '',
        bomLevel: item.bomLevel || 'L0',
        weight: item.weight || 0,
        maxLength: item.maxLength || 0,
        maxWidth: item.maxWidth || 0,
        maxHeight: item.maxHeight || 0,
        surfaceArea: item.surfaceArea || 0,
        file2d: null,
        file3d: null,
      });
    } else {
      setFormData({
        name: '',
        partNumber: '',
        description: '',
        itemType: defaultItemType || BOMItemType.ASSEMBLY,
        quantity: 1,
        annualVolume: 1000,
        unit: 'pcs',
        material: '',
        materialGrade: '',
        makeBuy: 'make',
        unitCost: '',
        bomLevel: 'L0',
        weight: 0,
        maxLength: 0,
        maxWidth: 0,
        maxHeight: 0,
        surfaceArea: 0,
        file2d: null,
        file3d: null,
      });
    }
  }, [item, open, defaultItemType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Pre-submission validation
    if (!validationStatus.isValid) {
      toast.error('Please fix validation errors before saving', {
        description: 'Check highlighted fields and try again',
        duration: 5000
      });
      return;
    }
    
    setLoading(true);

    try {
      // Use explicit parentItemId if provided, otherwise use auto-assigned parent
      const finalParentId = parentItemId !== undefined ? parentItemId : autoParentId;

      const payload = {
        bomId,
        name: formData.name,
        partNumber: formData.partNumber,
        description: formData.description || undefined,
        itemType: formData.itemType,
        parentItemId: finalParentId || undefined,
        quantity: formData.quantity,
        annualVolume: formData.annualVolume,
        unit: formData.unit,
        material: formData.material || undefined,
        materialGrade: formData.materialGrade || undefined,
        bomLevel: formData.bomLevel,
        makeBuy: formData.makeBuy,
        unitCost: formData.makeBuy === 'buy' ? parseFloat(formData.unitCost) || 0 : undefined,
        weight: formData.weight || undefined,
        maxLength: formData.maxLength || undefined,
        maxWidth: formData.maxWidth || undefined,
        maxHeight: formData.maxHeight || undefined,
        surfaceArea: formData.surfaceArea || undefined,
      };

      let itemId: string;

      if (item) {
        await updateBOMItem(item.id, payload);
        itemId = item.id;
        toast.success(`✅ "${formData.name}" updated successfully`, {
          description: 'BOM item has been updated with your changes',
          duration: 4000
        });
      } else {
        const newItem = await createBOMItem(payload);
        itemId = newItem.id;
        toast.success(`🎉 "${formData.name}" added to BOM`, {
          description: 'New item is now part of your Bill of Materials',
          duration: 4000
        });
      }

      // Upload files if provided with progress tracking
      if (formData.file2d || formData.file3d) {
        const formDataUpload = new FormData();
        const fileNames: string[] = [];
        
        if (formData.file2d) {
          formDataUpload.append('file2d', formData.file2d);
          fileNames.push(formData.file2d.name);
        }
        if (formData.file3d) {
          formDataUpload.append('file3d', formData.file3d);
          fileNames.push(formData.file3d.name);
        }

        try {
          // Simulate progress for better UX
          setUploadProgress({ file2d: 0, file3d: 0 });
          
          // Upload with simulated progress
          await apiClient.uploadFiles(`/bom-items/${itemId}/upload-files`, formDataUpload);
          
          setUploadProgress({ file2d: 100, file3d: 100 });
          
          toast.success(`📎 Files uploaded successfully`, {
            description: `${fileNames.join(', ')} attached to ${formData.name}`,
            duration: 4000
          });
        } catch (uploadError: any) {
          const errorInfo = categorizeBOMError(uploadError);
          
          // Enhanced file upload error handling
          const baseMessage = `Item saved but file upload ${errorInfo.recoverable ? 'failed' : 'was blocked'}`;
          
          toast.error(`📎 ${baseMessage}`, {
            description: errorInfo.suggestion,
            duration: errorInfo.severity === 'critical' ? 10000 : 7000,
            action: errorInfo.recoverable ? {
              label: 'Retry Upload',
              onClick: async () => {
                try {
                  await apiClient.uploadFiles(`/bom-items/${itemId}/upload-files`, formDataUpload);
                  toast.success('Files uploaded successfully on retry');
                } catch (retryError) {
                  toast.error('Upload failed again. Please try manually later.');
                }
              }
            } : undefined
          });
          
          setUploadProgress({});
        }
      }

      // Invalidate React Query cache to refresh the tree immediately
      await queryClient.invalidateQueries({ queryKey: ['bom-items', 'list', bomId] });

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      const errorInfo = categorizeBOMError(error);
      
      // Enhanced error categorization and user feedback
      const toastOptions: any = {
        description: errorInfo.suggestion,
        duration: errorInfo.severity === 'critical' ? 10000 : 7000
      };
      
      // Add contextual actions based on error category
      if (errorInfo.actionable && errorInfo.recoverable) {
        switch (errorInfo.category) {
          case 'validation':
            toastOptions.action = {
              label: 'Show Help',
              onClick: () => {
                if (errorInfo.helpUrl) {
                  window.open(errorInfo.helpUrl, '_blank');
                } else {
                  setShowHelp(prev => ({ ...prev, validation: true }));
                }
              }
            };
            break;
            
          case 'duplication':
            toastOptions.action = {
              label: 'Generate New Part#',
              onClick: () => {
                const timestamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
                const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
                setFormData(prev => ({ 
                  ...prev, 
                  partNumber: `${prev.partNumber || 'PT'}-${timestamp}-${randomSuffix}` 
                }));
                toast.info('New part number generated. Please review and adjust as needed.');
              }
            };
            break;
            
          case 'network':
            toastOptions.action = {
              label: 'Retry Save',
              onClick: () => handleSubmit(e)
            };
            break;
        }
      }
      
      // Show categorized error message
      const errorEmoji = {
        validation: '⚠️',
        duplication: '🔄',
        hierarchy: '🔗',
        fileupload: '📎',
        network: '🌐',
        permission: '🔒',
        business: '📋',
        data: 'ℹ️'
      }[errorInfo.category] || '❌';
      
      toast.error(`${errorEmoji} ${errorInfo.userMessage}`, toastOptions);
      
      // Log detailed error for debugging
      console.error('BOM Item Save Error:', {
        category: errorInfo.category,
        severity: errorInfo.severity,
        message: (error as any)?.message ?? String(error),
        status: (error as any)?.status ?? (error as any)?.statusCode,
        stack: (error as any)?.stack,
        formData: { ...formData, file2d: formData.file2d?.name, file3d: formData.file3d?.name },
      });
    } finally {
      setLoading(false);
      setUploadProgress({});
    }
  };
  
  // Toggle contextual help
  const toggleHelp = (field: string) => {
    setShowHelp(prev => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {item ? 'Edit BOM Item' : 'Create BOM Item'}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {item ? 'Update item details and specifications' : 'Add a new item to the Bill of Materials'}
                </DialogDescription>
              </div>
              
              {!item && (
                <div className="text-right">
                  <div className="text-sm font-medium text-muted-foreground">Completion</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={validationStatus.completionPercentage} className="w-16 h-2" />
                    <span className="text-xs text-muted-foreground">{validationStatus.completionPercentage}%</span>
                  </div>
                </div>
              )}
            </div>
            
            {/* Validation Summary */}
            {Object.keys(validationErrors).length > 0 && (
              <Alert variant="destructive" className="py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Please fix validation errors</AlertTitle>
                <AlertDescription className="text-xs mt-1">
                  {Object.keys(validationErrors).length} field{Object.keys(validationErrors).length !== 1 ? 's' : ''} need attention before saving
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="e.g., Cylinder Head Assembly"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className={validationErrors.name ? 'border-red-500 focus:border-red-500' : ''}
                required
              />
              {validationErrors.name && (
                <div className="flex items-center gap-1 text-xs text-red-600">
                  <XCircle className="h-3 w-3" />
                  <span>{validationErrors.name}</span>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="partNumber">Part Number *</Label>
              <Input
                id="partNumber"
                placeholder="e.g., CH-2024-001"
                value={formData.partNumber}
                onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
                className={validationErrors.partNumber ? 'border-red-500 focus:border-red-500' : ''}
                required
              />
              {validationErrors.partNumber && (
                <div className="flex items-center gap-1 text-xs text-red-600">
                  <XCircle className="h-3 w-3" />
                  <span>{validationErrors.partNumber}</span>
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Detailed description of the part..."
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="materialGrade">Material Grade</Label>
              <div className="relative">
                <Input
                  id="materialGrade"
                  value={formData.materialGrade || ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData({ ...formData, materialGrade: value });
                    setMaterialGradeSearch(value);
                    if (!materialGradeOpen) {
                      setMaterialGradeOpen(true);
                    }
                  }}
                  onFocus={() => {
                    setMaterialGradeOpen(true);
                    setMaterialGradeSearch(formData.materialGrade || '');
                  }}
                  onClick={() => {
                    setMaterialGradeOpen(true);
                  }}
                  placeholder="Type or select material grade..."
                  className="pr-10"
                  disabled={isLoadingMaterials}
                />
                <Popover open={materialGradeOpen} onOpenChange={setMaterialGradeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      type="button"
                    >
                      <ChevronsUpDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent 
                    className="w-full p-0" 
                    align="start"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <Command shouldFilter={false} className="max-h-[300px]">
                      <CommandList className="max-h-[300px] overflow-y-auto">
                        <CommandGroup>
                          {materialOptions.map((grade) => (
                            <div
                              key={grade}
                              onClick={() => {
                                setFormData({ 
                                  ...formData, 
                                  materialGrade: grade === formData.materialGrade ? '' : grade 
                                });
                                setMaterialGradeOpen(false);
                              }}
                              className={`
                                flex cursor-pointer items-center px-3 py-2 text-sm
                                ${formData.materialGrade === grade 
                                  ? 'bg-blue-500 text-white font-medium' 
                                  : 'text-black dark:text-white bg-white dark:bg-gray-800'
                                }
                              `}
                              style={{
                                opacity: 1,
                                color: formData.materialGrade === grade ? 'white' : 'inherit'
                              }}
                            >
                              <Check
                                className={`mr-2 h-4 w-4 ${
                                  formData.materialGrade === grade ? "opacity-100" : "opacity-0"
                                }`}
                                style={{ opacity: formData.materialGrade === grade ? 1 : 0 }}
                              />
                              <span 
                                className="font-medium"
                                style={{ opacity: 1, color: 'inherit' }}
                              >
                                {grade}
                              </span>
                            </div>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              {isLoadingMaterials && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading material grades from database...
                </p>
              )}
              {!isLoadingMaterials && materialOptions.length === 0 && materialGradeSearch && (
                <p className="text-xs text-muted-foreground">
                  No material grades found matching "{materialGradeSearch}". You can still use this custom value.
                </p>
              )}
              {!isLoadingMaterials && materialOptions.length === 0 && !materialGradeSearch && (
                <p className="text-xs text-muted-foreground">
                  No material grades available. Add materials to the raw materials database first.
                </p>
              )}
            </div>


            {/* Make or Buy Decision */}
            <div className="grid gap-3 border-t pt-4">
              <Label>Make or Buy Decision</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="makeBuy"
                    value="make"
                    checked={formData.makeBuy === 'make'}
                    onChange={(e) => setFormData({ ...formData, makeBuy: e.target.value as 'make' | 'buy' })}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">Manufacturing (Make)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="makeBuy"
                    value="buy"
                    checked={formData.makeBuy === 'buy'}
                    onChange={(e) => setFormData({ ...formData, makeBuy: e.target.value as 'make' | 'buy' })}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">Purchasing (Buy)</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {formData.makeBuy === 'make'
                  ? 'Part will be manufactured in-house'
                  : 'Part will be purchased from supplier'}
              </p>

              {/* Cost field - only shown for Buy option */}
              {formData.makeBuy === 'buy' && (
                <div className="grid gap-2 mt-2 p-4 border rounded-lg bg-muted/30">
                  <Label htmlFor="unitCost" className="flex items-center gap-2">
                    Unit Cost (Purchasing)
                    <span className="text-xs text-muted-foreground font-normal">(₹)</span>
                  </Label>
                  <Input
                    id="unitCost"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Enter supplier quoted price"
                    value={formData.unitCost}
                    onChange={(e) => {
                      setFormData({ ...formData, unitCost: e.target.value });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Supplier quoted price per unit in Indian Rupees (INR)
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="file2d" className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  2D Drawing (PDF, DWG, PNG, JPG)
                </Label>
                <Input
                  id="file2d"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
                  onChange={(e) => setFormData({ ...formData, file2d: e.target.files?.[0] || null })}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/80"
                />
                {formData.file2d ? (
                  <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded p-2">
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    <span className="text-green-700 dark:text-green-300">Selected: {formData.file2d.name}</span>
                    <span className="text-green-600 dark:text-green-400">({(formData.file2d.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    📐 Upload technical drawings, blueprints, or dimensional sketches
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="file3d" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  3D Model (STEP, STL, IGES, OBJ)
                </Label>
                <Input
                  id="file3d"
                  type="file"
                  accept=".stp,.step,.stl,.obj,.iges,.igs"
                  onChange={(e) => setFormData({ ...formData, file3d: e.target.files?.[0] || null })}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/80"
                />
                {formData.file3d ? (
                  <div className="flex items-center gap-2 text-xs bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded p-2">
                    <CheckCircle className="h-3 w-3 text-green-600" />
                    <span className="text-green-700 dark:text-green-300">Selected: {formData.file3d.name}</span>
                    <span className="text-green-600 dark:text-green-400">({(formData.file3d.size / 1024 / 1024).toFixed(1)} MB)</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    🎯 Upload CAD models for visualization and manufacturing analysis
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => toggleHelp('quantity')}
                  >
                    <HelpCircle className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                  className={validationErrors.quantity ? 'border-red-500 focus:border-red-500' : ''}
                  required
                />
                {validationErrors.quantity && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" />
                    <span>{validationErrors.quantity}</span>
                  </div>
                )}
                
                {showHelp.quantity && (
                  <Alert className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle className="text-sm">Quantity Guidelines</AlertTitle>
                    <AlertDescription className="text-xs mt-1">
                      <ul className="list-disc list-inside space-y-1">
                        <li>Number of this item needed in the parent assembly</li>
                        <li>Should be the quantity per assembly, not total production</li>
                        <li>For example: If an engine needs 4 pistons, enter "4"</li>
                        <li>Must be a positive integer greater than 0</li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="annualVolume">Annual Volume *</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => toggleHelp('annualVolume')}
                  >
                    <HelpCircle className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  id="annualVolume"
                  type="number"
                  min="1"
                  value={formData.annualVolume}
                  onChange={(e) => setFormData({ ...formData, annualVolume: parseInt(e.target.value) || 1 })}
                  className={validationErrors.annualVolume ? 'border-red-500 focus:border-red-500' : ''}
                  required
                />
                {validationErrors.annualVolume && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" />
                    <span>{validationErrors.annualVolume}</span>
                  </div>
                )}
                
                {showHelp.annualVolume && (
                  <Alert className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle className="text-sm">Annual Volume Guidelines</AlertTitle>
                    <AlertDescription className="text-xs mt-1">
                      <ul className="list-disc list-inside space-y-1">
                        <li>Expected number of units needed per year</li>
                        <li>Used for cost calculations and supplier negotiations</li>
                        <li>Consider production forecasts and demand planning</li>
                        <li>Include safety stock and buffer requirements</li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>

            {/* Physical Properties */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3">Physical Properties (Optional)</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="weight">Weight (kg)</Label>
                  <Input
                    id="weight"
                    type="number"
                    step="0.001"
                    min="0"
                    value={formData.weight || ''}
                    onChange={(e) => setFormData({ ...formData, weight: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="surfaceArea">Surface Area (mm²)</Label>
                  <Input
                    id="surfaceArea"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.surfaceArea || ''}
                    onChange={(e) => setFormData({ ...formData, surfaceArea: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxLength">Max Length (mm)</Label>
                  <Input
                    id="maxLength"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.maxLength || ''}
                    onChange={(e) => setFormData({ ...formData, maxLength: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxWidth">Max Width (mm)</Label>
                  <Input
                    id="maxWidth"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.maxWidth || ''}
                    onChange={(e) => setFormData({ ...formData, maxWidth: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="maxHeight">Max Height (mm)</Label>
                  <Input
                    id="maxHeight"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.maxHeight || ''}
                    onChange={(e) => setFormData({ ...formData, maxHeight: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="unit">UOM</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(value) => setFormData({ ...formData, unit: value })}
                >
                  <SelectTrigger id="unit">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">Pieces</SelectItem>
                    <SelectItem value="kg">Kilograms</SelectItem>
                    <SelectItem value="lbs">Pounds</SelectItem>
                    <SelectItem value="m">Meters</SelectItem>
                    <SelectItem value="ft">Feet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="itemType">Type *</Label>
                  <Badge variant="secondary" className="text-xs">
                    BOM Level: {formData.bomLevel}
                  </Badge>
                </div>
                <Select
                  value={formData.itemType}
                  onValueChange={(value) => setFormData({ ...formData, itemType: value as BOMItemType })}
                >
                  <SelectTrigger id="itemType">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="space-y-1">
                  {!item && autoParentId && formData.itemType !== BOMItemType.ASSEMBLY && (
                    <p className="text-xs text-muted-foreground">
                      Will be added under: {
                        formData.itemType === BOMItemType.SUB_ASSEMBLY ? 'Latest Assembly' :
                          formData.itemType === BOMItemType.CHILD_PART ? 'Latest Sub-Assembly' : ''
                      }
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    BOM Level is automatically assigned based on item type
                  </p>
                </div>
              </div>
            </div>

          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading || !validationStatus.isValid}
              className="min-w-24"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {item ? 'Updating...' : 'Creating...'}
                  {(uploadProgress.file2d !== undefined || uploadProgress.file3d !== undefined) && (
                    <span className="ml-2 text-xs opacity-75">
                      {uploadProgress.file2d || uploadProgress.file3d || 0}%
                    </span>
                  )}
                </>
              ) : (
                <>
                  {item ? (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      Update Item
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Item
                    </>
                  )}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
