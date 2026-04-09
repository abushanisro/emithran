'use client';

import { useState, useEffect } from 'react';
import { Plus, Trash2, Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { DataSource } from '@/lib/api/calculators';
import { DatabaseRecordPicker } from './DatabaseRecordPicker';
import { cn } from '@/lib/utils';

type MaterialSelection = {
  id: string;
  label: string;
  category: string;
  selectedMaterial: any;
  selectedField: string;
  extractedValue: any;
  displayValue: string;
};

type MaterialPickerGridProps = {
  dataSource: DataSource;
  selections: MaterialSelection[];
  onSelectionsChange: (selections: MaterialSelection[]) => void;
  disabled?: boolean;
  associatedProcessId?: string;
};

// Available material property fields from the actual API response
const AVAILABLE_FIELDS = [
  // Plastic & Rubber Properties (as per your requirements)
  { field: 'categoryName', label: 'Group', description: 'Material group/category', categories: ['PLASTIC'] },
  { field: 'materialName', label: 'Material', description: 'Name of the material', categories: ['PLASTIC'] },
  { field: 'materialGrade', label: 'Grade', description: 'Material grade/specification', categories: ['PLASTIC'] },
  // Note: Country and Shape fields might be missing from API - need to add these to backend
  { field: 'country', label: 'Country', description: 'Country of origin', categories: ['PLASTIC', 'FERROUS'] },
  { field: 'shape', label: 'Shape', description: 'Material shape/form', categories: ['PLASTIC', 'FERROUS'] },
  { field: 'shrinkageRatePercent', label: 'Regrinding %', description: 'Regrinding percentage', categories: ['PLASTIC'] },
  { field: 'clampingPressureMpa', label: 'Clamping Pressure (MPa)', description: 'Required clamping pressure in MPa', categories: ['PLASTIC'] },
  { field: 'ejectDeflectionTempCelsius', label: 'Eject Deflection Temp (°C)', description: 'Ejection deflection temperature in Celsius', categories: ['PLASTIC'] },
  { field: 'meltingTempCelsius', label: 'Melting Temp (°C)', description: 'Melting temperature in Celsius', categories: ['PLASTIC'] },
  { field: 'moldTempCelsiusMin', label: 'Mold Temp (°C)', description: 'Mold temperature in Celsius', categories: ['PLASTIC'] },
  { field: 'densityKgM3', label: 'Density (kg/m³)', description: 'Material density in kg/m³', categories: ['PLASTIC'] },
  { field: 'specificHeatJGK', label: 'Specific Heat (J/g·°C)', description: 'Specific heat capacity in J/g·K', categories: ['PLASTIC'] },
  { field: 'thermalConductivityWMK', label: 'Thermal Conductivity (W/m·°C)', description: 'Thermal conductivity in W/m·K', categories: ['PLASTIC'] },
  { field: 'costPerKg', label: 'Cost', description: 'Price per kilogram', categories: ['PLASTIC'] },

  // Ferrous & Non-Ferrous Properties  
  { field: 'categoryName', label: 'Group', description: 'Material group/category', categories: ['FERROUS'] },
  { field: 'materialName', label: 'Material', description: 'Name of the material', categories: ['FERROUS'] },
  { field: 'materialGrade', label: 'Type', description: 'Material type/grade', categories: ['FERROUS'] },
  { field: 'materialSpecification', label: 'Description', description: 'Material specification standard', categories: ['FERROUS'] },
  { field: 'densityKgM3', label: 'Density (g/cm³)', description: 'Material density (converted to g/cm³)', categories: ['FERROUS'] },
  { field: 'utsMpa', label: 'UTS (MPa)', description: 'Ultimate Tensile Strength in MPa', categories: ['FERROUS'] },
  { field: 'ytsMpa', label: 'YTS (MPa)', description: 'Yield Tensile Strength in MPa', categories: ['FERROUS'] },
  { field: 'costPerKg', label: 'Cost', description: 'Price per kilogram', categories: ['FERROUS'] },

  // Common Properties
  { field: 'manufacturer', label: 'Manufacturer', description: 'Material manufacturer', categories: ['all'] },
  { field: 'supplier', label: 'Supplier', description: 'Material supplier', categories: ['all'] },
  { field: 'storageLocation', label: 'Storage Location', description: 'Storage location identifier', categories: ['all'] },
  { field: 'qualityGrade', label: 'Quality Grade', description: 'Quality classification grade', categories: ['all'] },
];

export function MaterialPickerGrid({
  dataSource,
  selections,
  onSelectionsChange,
  disabled = false,
  associatedProcessId,
}: MaterialPickerGridProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [categories, setCategories] = useState<any[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  
  // Fetch categories from API
  useEffect(() => {
    const fetchCategories = async () => {
      setCategoriesLoading(true);
      try {
        const { apiClient } = await import('@/lib/api/client');
        const response = await apiClient.get('/raw-materials/categories');
        
        // Handle nested response structure: response.data.categories
        const categories = response?.data?.categories || response?.categories || [];
        
        if (categories && categories.length > 0) {
          setCategories(categories);
        } else {
        }
      } catch (error) {
        console.error('Failed to fetch categories:', error);
      } finally {
        setCategoriesLoading(false);
      }
    };

    fetchCategories();
  }, []);
  
  // Generate unique ID for new selections
  const generateId = () => `material-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Get fields for selected category
  const getFieldsForCategory = (categoryCode: string) => {
    return AVAILABLE_FIELDS.filter(field => 
      field.categories.includes('all') || 
      field.categories.includes(categoryCode)
    );
  };
  
  // Add a new material selection
  const handleAddSelection = (template?: { field: string; label: string; description: string }) => {
    const newSelection: MaterialSelection = {
      id: generateId(),
      label: template?.label || 'Custom Material Property',
      category: selectedTemplate || 'Custom',
      selectedMaterial: null,
      selectedField: template?.field || '',
      extractedValue: null,
      displayValue: '',
    };
    
    onSelectionsChange([...selections, newSelection]);
  };
  
  // Remove a material selection
  const handleRemoveSelection = (id: string) => {
    onSelectionsChange(selections.filter(s => s.id !== id));
  };
  
  // Update material selection
  const handleMaterialSelect = (selectionId: string, material: any) => {
    
    // Extract the actual material data from the record
    const materialData = material?.materialData || material;
    
    const updatedSelections = selections.map(selection => {
      if (selection.id === selectionId) {
        // Extract the field value from the selected material data using the predefined field
        const fieldValue = selection.selectedField ? materialData?.[selection.selectedField] : null;
        let displayValue = '';
        
        
        if (fieldValue !== null && fieldValue !== undefined) {
          // Format the display value based on field type
          const fieldConfig = AVAILABLE_FIELDS.find(f => f.field === selection.selectedField);
          const fieldLabel = fieldConfig?.label || selection.selectedField;
          
          if (fieldLabel.includes('Density') && materialData?.categoryCode === 'FERROUS') {
            // Convert kg/m³ to g/cm³ for metals
            displayValue = fieldValue ? `${(fieldValue / 1000).toFixed(2)} g/cm³` : '';
          } else if (fieldLabel.includes('Temp') || fieldLabel.includes('Temperature')) {
            displayValue = fieldValue ? `${fieldValue}°C` : '';
          } else if (fieldLabel.includes('Pressure')) {
            displayValue = fieldValue ? `${fieldValue} MPa` : '';
          } else if (fieldLabel.includes('Cost') || fieldLabel.includes('Price')) {
            displayValue = fieldValue ? `₹${fieldValue}/kg` : '';
          } else if (fieldLabel.includes('%')) {
            displayValue = fieldValue ? `${fieldValue}%` : '';
          } else if (fieldLabel.includes('(MPa)')) {
            displayValue = fieldValue ? `${fieldValue} MPa` : '';
          } else if (fieldLabel.includes('(GPa)')) {
            displayValue = fieldValue ? `${fieldValue} GPa` : '';
          } else if (fieldLabel.includes('(Days)')) {
            displayValue = fieldValue ? `${fieldValue} days` : '';
          } else {
            displayValue = String(fieldValue);
          }
        }
        
        console.log('[MaterialPickerGrid] Final display value:', displayValue);
        
        return {
          ...selection,
          selectedMaterial: material,
          selectedMaterialData: materialData,
          extractedValue: fieldValue,
          displayValue,
        };
      }
      return selection;
    });
    
    onSelectionsChange(updatedSelections);
  };
  

  return (
    <div className="space-y-4">
      {/* Template Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Material Properties</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {categoriesLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Loading categories...</span>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Choose material category..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.categoryCode}>
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full" 
                            style={{ backgroundColor: category.colorCode }}
                          />
                          <span>{category.categoryName}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => handleAddSelection()}
                  disabled={disabled}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Custom
                </Button>
              </div>
              
              {/* Template Buttons */}
              {selectedTemplate && (
                <div className="grid grid-cols-2 gap-2">
                  {getFieldsForCategory(selectedTemplate).slice(0, 8).map((field) => (
                    <Button
                      key={field.field}
                      variant="outline"
                      size="sm"
                      className="justify-start text-xs h-8"
                      onClick={() => handleAddSelection(field)}
                      disabled={disabled}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {field.label}
                    </Button>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Material Selections */}
      <div className="space-y-3">
        {selections.map((selection, index) => (
          <Card key={selection.id} className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {selection.category}
                  </Badge>
                  <span className="font-medium text-sm">{selection.label}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveSelection(selection.id)}
                  disabled={disabled}
                  className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Material Picker */}
              <div>
                <Label className="text-xs text-muted-foreground mb-1">Select Material</Label>
                <DatabaseRecordPicker
                  dataSource={dataSource}
                  value={selection.selectedMaterial?.id}
                  onSelect={(material) => handleMaterialSelect(selection.id, material)}
                  placeholder={`Select material for ${selection.label.toLowerCase()}...`}
                  disabled={disabled}
                  associatedProcessId={associatedProcessId}
                  selectedCategory={selectedTemplate}
                />
              </div>
              
              
              {/* Extracted Value Display */}
              {selection.displayValue && (
                <div className="p-2 bg-green-50 border border-green-200 rounded">
                  <div className="flex items-center gap-2">
                    <Eye className="h-3 w-3 text-green-600" />
                    <span className="text-sm font-medium text-green-800">
                      Extracted: {selection.displayValue}
                    </span>
                  </div>
                  <span className="text-xs text-green-600">
                    From: {selection.selectedMaterial?.materialName || selection.selectedMaterial?.displayLabel}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      
      {/* Empty State */}
      {selections.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center">
            <div className="text-muted-foreground">
              <Plus className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No material properties selected</p>
              <p className="text-xs">Choose a template above or add custom properties</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}