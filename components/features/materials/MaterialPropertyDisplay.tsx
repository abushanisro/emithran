'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Thermometer, 
  Gauge, 
  Zap, 
  Settings, 
  Package, 
  DollarSign,
  Info,
  Building,
  MapPin,
  Calendar,
  Award
} from 'lucide-react';

interface MaterialProperty {
  id: string;
  material_name: string;
  material_grade?: string;
  material_specification?: string;
  manufacturer?: string;
  supplier?: string;
  category_name: string;
  category_code: string;
  color_code: string;
  
  // Cost Properties
  cost_per_kg?: number;
  cost_per_unit?: number;
  unit_type: string;
  
  // Mechanical Properties
  density_kg_m3?: number;
  uts_mpa?: number;
  yts_mpa?: number;
  elastic_modulus_gpa?: number;
  hardness_value?: number;
  hardness_scale?: string;
  
  // Thermal Properties
  melting_temp_celsius?: number;
  eject_deflection_temp_celsius?: number;
  thermal_conductivity_w_m_k?: number;
  specific_heat_j_g_k?: number;
  max_service_temp_celsius?: number;
  
  // Processing Properties
  mold_temp_celsius_min?: number;
  mold_temp_celsius_max?: number;
  clamping_pressure_mpa?: number;
  injection_pressure_mpa_min?: number;
  injection_pressure_mpa_max?: number;
  shrinkage_rate_percent?: number;
  
  // Storage & Business
  storage_location?: string;
  lead_time_days?: number;
  minimum_order_quantity?: number;
  quality_grade?: string;
}

interface MaterialPropertyDisplayProps {
  material: MaterialProperty;
  showAllFields?: boolean;
  compact?: boolean;
}

export function MaterialPropertyDisplay({ 
  material, 
  showAllFields = true, 
  compact = false 
}: MaterialPropertyDisplayProps) {
  const formatValue = (value: number | undefined, unit = '', decimals = 2) => {
    if (value === undefined || value === null) return '—';
    return `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
  };

  const formatCurrency = (value?: number) => {
    if (!value) return '—';
    return `$${value.toFixed(2)}`;
  };

  const isPlastic = material.category_code === 'PLASTIC' || 
                   material.category_name.toLowerCase().includes('plastic');
  
  const isMetal = material.category_code === 'FERROUS' || 
                  material.category_code === 'NON_FERROUS' ||
                  material.category_name.toLowerCase().includes('ferrous') ||
                  material.category_name.toLowerCase().includes('metal');

  if (compact) {
    return (
      <Card className="w-full">
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            <div 
              className="w-4 h-4 rounded-full flex-shrink-0 mt-1" 
              style={{ backgroundColor: material.color_code }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-base">{material.material_name}</h3>
                  {material.material_grade && (
                    <p className="text-sm text-muted-foreground">{material.material_grade}</p>
                  )}
                  <Badge variant="outline" className="mt-1 text-xs">
                    {material.category_name}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-green-600">
                    {formatCurrency(material.cost_per_kg)}/kg
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Density: {formatValue(material.density_kg_m3, 'kg/m³', 0)}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                {isPlastic && (
                  <>
                    <div>Melting: {formatValue(material.melting_temp_celsius, '°C', 0)}</div>
                    <div>Mold Temp: {formatValue(material.mold_temp_celsius_min, '°C', 0)}</div>
                  </>
                )}
                {isMetal && (
                  <>
                    <div>UTS: {formatValue(material.uts_mpa, 'MPa', 0)}</div>
                    <div>YTS: {formatValue(material.yts_mpa, 'MPa', 0)}</div>
                  </>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-4">
            <div 
              className="w-6 h-6 rounded-full flex-shrink-0" 
              style={{ backgroundColor: material.color_code }}
            />
            <div className="flex-1">
              <CardTitle className="text-2xl">{material.material_name}</CardTitle>
              <div className="flex flex-wrap gap-2 mt-2">
                {material.material_grade && (
                  <Badge variant="outline">{material.material_grade}</Badge>
                )}
                {material.material_specification && (
                  <Badge variant="secondary">{material.material_specification}</Badge>
                )}
                <Badge style={{ backgroundColor: material.color_code, color: 'white' }}>
                  {material.category_name}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(material.cost_per_kg)}
              </div>
              <div className="text-sm text-muted-foreground">per kg</div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Info className="h-5 w-5" />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-muted-foreground">Material:</span>
                <p className="font-semibold">{material.material_name}</p>
              </div>
              {material.material_grade && (
                <div>
                  <span className="font-medium text-muted-foreground">Grade:</span>
                  <p className="font-semibold">{material.material_grade}</p>
                </div>
              )}
              {material.manufacturer && (
                <div>
                  <span className="font-medium text-muted-foreground">Manufacturer:</span>
                  <p className="font-semibold">{material.manufacturer}</p>
                </div>
              )}
              {material.supplier && (
                <div>
                  <span className="font-medium text-muted-foreground">Supplier:</span>
                  <p className="font-semibold">{material.supplier}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Cost Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <DollarSign className="h-5 w-5" />
              Cost Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-muted-foreground">Cost per KG:</span>
                <p className="font-semibold text-green-600">{formatCurrency(material.cost_per_kg)}</p>
              </div>
              {material.cost_per_unit && (
                <div>
                  <span className="font-medium text-muted-foreground">Cost per Unit:</span>
                  <p className="font-semibold text-green-600">
                    {formatCurrency(material.cost_per_unit)} / {material.unit_type}
                  </p>
                </div>
              )}
              {material.minimum_order_quantity && (
                <div>
                  <span className="font-medium text-muted-foreground">Min. Order:</span>
                  <p className="font-semibold">{material.minimum_order_quantity} {material.unit_type}</p>
                </div>
              )}
              {material.lead_time_days && (
                <div>
                  <span className="font-medium text-muted-foreground">Lead Time:</span>
                  <p className="font-semibold">{material.lead_time_days} days</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Mechanical Properties */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gauge className="h-5 w-5" />
            Mechanical Properties
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {material.density_kg_m3 && (
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {formatValue(material.density_kg_m3, '', 0)}
                </div>
                <div className="text-sm text-muted-foreground">Density (kg/m³)</div>
              </div>
            )}
            {material.uts_mpa && (
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {formatValue(material.uts_mpa, '', 0)}
                </div>
                <div className="text-sm text-muted-foreground">UTS (MPa)</div>
              </div>
            )}
            {material.yts_mpa && (
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {formatValue(material.yts_mpa, '', 0)}
                </div>
                <div className="text-sm text-muted-foreground">YTS (MPa)</div>
              </div>
            )}
            {material.elastic_modulus_gpa && (
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {formatValue(material.elastic_modulus_gpa)}
                </div>
                <div className="text-sm text-muted-foreground">Elastic Modulus (GPa)</div>
              </div>
            )}
            {material.hardness_value && (
              <div className="text-center p-4 bg-gray-50 rounded-lg">
                <div className="text-2xl font-bold text-gray-600">
                  {formatValue(material.hardness_value, '', 0)}
                </div>
                <div className="text-sm text-muted-foreground">
                  Hardness ({material.hardness_scale || 'HRC'})
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Thermal Properties */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Thermometer className="h-5 w-5" />
            Thermal Properties
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {material.melting_temp_celsius && (
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {formatValue(material.melting_temp_celsius, '', 0)}
                </div>
                <div className="text-sm text-muted-foreground">Melting Temp (°C)</div>
              </div>
            )}
            {material.eject_deflection_temp_celsius && (
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {formatValue(material.eject_deflection_temp_celsius, '', 0)}
                </div>
                <div className="text-sm text-muted-foreground">Eject Deflection (°C)</div>
              </div>
            )}
            {material.thermal_conductivity_w_m_k && (
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {formatValue(material.thermal_conductivity_w_m_k, '', 3)}
                </div>
                <div className="text-sm text-muted-foreground">Thermal Conductivity (W/m·K)</div>
              </div>
            )}
            {material.specific_heat_j_g_k && (
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {formatValue(material.specific_heat_j_g_k, '', 3)}
                </div>
                <div className="text-sm text-muted-foreground">Specific Heat (J/g·K)</div>
              </div>
            )}
            {material.max_service_temp_celsius && (
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {formatValue(material.max_service_temp_celsius, '', 0)}
                </div>
                <div className="text-sm text-muted-foreground">Max Service Temp (°C)</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Processing Properties (for Plastics) */}
      {isPlastic && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Settings className="h-5 w-5" />
              Processing Properties
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {material.clamping_pressure_mpa && (
                <div className="text-center p-4 bg-red-50 rounded-lg">
                  <div className="text-2xl font-bold text-red-600">
                    {formatValue(material.clamping_pressure_mpa, '', 1)}
                  </div>
                  <div className="text-sm text-muted-foreground">Clamping Pressure (MPa)</div>
                </div>
              )}
              {material.mold_temp_celsius_min && (
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatValue(material.mold_temp_celsius_min, '', 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Mold Temp Min (°C)</div>
                </div>
              )}
              {material.mold_temp_celsius_max && (
                <div className="text-center p-4 bg-blue-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {formatValue(material.mold_temp_celsius_max, '', 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Mold Temp Max (°C)</div>
                </div>
              )}
              {material.injection_pressure_mpa_min && (
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {formatValue(material.injection_pressure_mpa_min, '', 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Injection Min (MPa)</div>
                </div>
              )}
              {material.injection_pressure_mpa_max && (
                <div className="text-center p-4 bg-green-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {formatValue(material.injection_pressure_mpa_max, '', 0)}
                  </div>
                  <div className="text-sm text-muted-foreground">Injection Max (MPa)</div>
                </div>
              )}
              {material.shrinkage_rate_percent && (
                <div className="text-center p-4 bg-purple-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {formatValue(material.shrinkage_rate_percent, '%', 3)}
                  </div>
                  <div className="text-sm text-muted-foreground">Shrinkage Rate</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Storage & Logistics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5" />
            Storage & Logistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {material.storage_location && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="font-medium text-muted-foreground">Storage Location:</span>
                  <p className="font-semibold">{material.storage_location}</p>
                </div>
              </div>
            )}
            {material.quality_grade && (
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="font-medium text-muted-foreground">Quality Grade:</span>
                  <p className="font-semibold">{material.quality_grade}</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}