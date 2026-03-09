'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  MATERIAL_PROPERTY_LABELS,
  MATERIAL_STANDARDS_LABELS,
  COUNTRY_LABELS,
  CURRENCY_LABELS,
  MATERIAL_SHAPE_LABELS,
  COUNTRY_DEFAULT_CURRENCY,
  Country,
  Currency,
  MaterialShape,
  getCurrencyForCountry
} from '@/lib/constants/materials';

interface FerrousNonFerrousMaterial {
  // Basic material info
  materialGroup: string;
  material: string;
  materialGrade?: string;
  materialType?: string;
  materialDescription?: string;
  location?: string;
  
  // Material properties
  density?: number;
  ultimateTensileStrength?: number;
  yieldTensileStrength?: number;
  shearingStrength?: number;
  
  // Geographic and form
  country?: Country;
  shape?: MaterialShape;
  
  // Cost
  unitCost?: number;
  currency?: Currency;
  
  // Standards
  astmStandard?: string;
  dinStandard?: string;
  enStandard?: string;
  jisStandard?: string;
}

interface FerrousNonFerrousFormProps {
  material: FerrousNonFerrousMaterial;
  onMaterialChange: (material: FerrousNonFerrousMaterial) => void;
  isEditing?: boolean;
}

export function FerrousNonFerrousForm({ 
  material, 
  onMaterialChange, 
  isEditing = false 
}: FerrousNonFerrousFormProps) {
  const handleChange = (field: keyof FerrousNonFerrousMaterial) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onMaterialChange({
      ...material,
      [field]: value
    });
  };

  const handleNumberChange = (field: keyof FerrousNonFerrousMaterial) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value ? parseFloat(e.target.value) : undefined;
    onMaterialChange({
      ...material,
      [field]: value
    });
  };

  const handleSelectChange = (field: keyof FerrousNonFerrousMaterial) => (value: string) => {
    onMaterialChange({
      ...material,
      [field]: value
    });
  };

  const handleCountryChange = (countryValue: string) => {
    const country = countryValue as Country;
    const defaultCurrency = getCurrencyForCountry(country);
    
    onMaterialChange({
      ...material,
      country,
      currency: defaultCurrency
    });
  };


  return (
    <div className="space-y-6">
      {/* Material Identification */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Material Identification</CardTitle>
          <CardDescription>
            Basic material information and identification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Material Group *</Label>
              <Input
                placeholder="e.g., Ferrous & Non-Ferrous"
                value={material.materialGroup || ''}
                onChange={handleChange('materialGroup')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Material Type</Label>
              <Input
                placeholder="e.g., Stainless Steel"
                value={material.materialType || ''}
                onChange={handleChange('materialType')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Material *</Label>
              <Input
                placeholder="e.g., 304 Stainless Steel"
                value={material.material || ''}
                onChange={handleChange('material')}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label className="text-sm font-medium">Material Description</Label>
              <Input
                placeholder="Detailed description of the material"
                value={material.materialDescription || ''}
                onChange={handleChange('materialDescription')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Grade</Label>
              <Input
                placeholder="e.g., 304L"
                value={material.materialGrade || ''}
                onChange={handleChange('materialGrade')}
              />
            </div>
          </div>
        </CardContent>
      </Card>


      {/* Material Properties */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Material Properties</CardTitle>
          <CardDescription>
            Physical and mechanical properties
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Country</Label>
              <Select
                value={material.country || ''}
                onValueChange={handleCountryChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COUNTRY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">Shape</Label>
              <Select
                value={material.shape || ''}
                onValueChange={handleSelectChange('shape')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select shape" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MATERIAL_SHAPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_PROPERTY_LABELS.density}</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="7.85"
                value={material.density?.toString() || ''}
                onChange={handleNumberChange('density')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_PROPERTY_LABELS.ultimate_tensile_strength}</Label>
              <Input
                type="number"
                step="1"
                placeholder="520"
                value={material.ultimateTensileStrength?.toString() || ''}
                onChange={handleNumberChange('ultimateTensileStrength')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_PROPERTY_LABELS.yield_tensile_strength}</Label>
              <Input
                type="number"
                step="1"
                placeholder="350"
                value={material.yieldTensileStrength?.toString() || ''}
                onChange={handleNumberChange('yieldTensileStrength')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_PROPERTY_LABELS.shearing_strength}</Label>
              <Input
                type="number"
                step="1"
                placeholder="315"
                value={material.shearingStrength?.toString() || ''}
                onChange={handleNumberChange('shearingStrength')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Standards */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Material Standards</CardTitle>
          <CardDescription>
            International material standards and specifications
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_STANDARDS_LABELS.astm_standard}</Label>
              <Input
                placeholder="e.g., ASTM A240"
                value={material.astmStandard || ''}
                onChange={handleChange('astmStandard')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_STANDARDS_LABELS.din_standard}</Label>
              <Input
                placeholder="e.g., DIN 1.4301"
                value={material.dinStandard || ''}
                onChange={handleChange('dinStandard')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_STANDARDS_LABELS.en_standard}</Label>
              <Input
                placeholder="e.g., EN 10088-2"
                value={material.enStandard || ''}
                onChange={handleChange('enStandard')}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">{MATERIAL_STANDARDS_LABELS.jis_standard}</Label>
              <Input
                placeholder="e.g., JIS SUS304"
                value={material.jisStandard || ''}
                onChange={handleChange('jisStandard')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost Information */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">Cost Information</CardTitle>
          <CardDescription>
            Material cost and currency details
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Unit Cost</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g., 135.00"
                value={material.unitCost?.toString() || ''}
                onChange={handleNumberChange('unitCost')}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}