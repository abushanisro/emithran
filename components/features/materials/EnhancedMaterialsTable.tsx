'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Search, 
  Edit, 
  Trash2, 
  Plus, 
  Filter,
  Download,
  Upload,
  Settings
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
  
  // Processing Properties (for Plastics)
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
  
  // Metadata
  status: string;
  created_at: string;
  updated_at: string;
}

interface MaterialCategory {
  id: string;
  category_name: string;
  category_code: string;
  color_code: string;
  description: string;
}

export function EnhancedMaterialsTable() {
  const [materials, setMaterials] = useState<MaterialProperty[]>([]);
  const [categories, setCategories] = useState<MaterialCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);

  // Fetch materials and categories
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch materials
        const params = new URLSearchParams({
          page: page.toString(),
          limit: limit.toString(),
          ...(search && { search }),
          ...(categoryFilter !== 'all' && { category: categoryFilter }),
        });

        const materialsResponse = await fetch(`/api/raw-materials/enhanced?${params}`);
        const materialsData = await materialsResponse.json();

        if (materialsData.success) {
          setMaterials(materialsData.items || []);
          setTotal(materialsData.pagination?.total || 0);
        }

        // Fetch categories
        const categoriesResponse = await fetch('/api/raw-materials/categories');
        const categoriesData = await categoriesResponse.json();

        if (categoriesData.success) {
          setCategories(categoriesData.categories || []);
        }

      } catch (error) {
        console.error('Failed to fetch materials:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [page, search, categoryFilter]);

  // Format currency
  const formatCurrency = (value?: number, unit = 'kg') => {
    if (!value) return '—';
    return `$${value.toFixed(2)}/${unit}`;
  };

  // Format decimal
  const formatDecimal = (value?: number, decimals = 2) => {
    if (value === null || value === undefined) return '—';
    return value.toFixed(decimals);
  };

  // Get category-specific columns for plastics
  const PlasticsColumns = () => (
    <TableRow>
      <TableHead className="w-[120px]">Group</TableHead>
      <TableHead className="w-[140px]">Material</TableHead>
      <TableHead className="w-[100px]">Grade</TableHead>
      <TableHead className="w-[80px]">Shape</TableHead>
      <TableHead className="w-[100px]">Regrind %</TableHead>
      <TableHead className="w-[120px]">Clamping Pressure (MPa)</TableHead>
      <TableHead className="w-[140px]">Eject Deflection Temp (°C)</TableHead>
      <TableHead className="w-[120px]">Melting Temp (°C)</TableHead>
      <TableHead className="w-[120px]">Mold Temp (°C)</TableHead>
      <TableHead className="w-[120px]">Density (kg/m³)</TableHead>
      <TableHead className="w-[140px]">Specific Heat (J/g·°C)</TableHead>
      <TableHead className="w-[160px]">Thermal Conductivity (W/m·°C)</TableHead>
      <TableHead className="w-[100px]">Cost</TableHead>
      <TableHead className="w-[100px]">Actions</TableHead>
    </TableRow>
  );

  // Get category-specific columns for metals
  const MetalsColumns = () => (
    <TableRow>
      <TableHead className="w-[120px]">Group</TableHead>
      <TableHead className="w-[140px]">Material</TableHead>
      <TableHead className="w-[100px]">Type</TableHead>
      <TableHead className="w-[200px]">Description</TableHead>
      <TableHead className="w-[80px]">Shape</TableHead>
      <TableHead className="w-[100px]">Country</TableHead>
      <TableHead colSpan={4} className="text-center bg-blue-50 font-bold">PROPERTIES</TableHead>
      <TableHead colSpan={4} className="text-center bg-green-50 font-bold">STANDARDS</TableHead>
      <TableHead className="w-[100px]">Cost</TableHead>
      <TableHead className="w-[100px]">Actions</TableHead>
    </TableRow>
  );

  // Sub-headers for metals properties and standards
  const MetalsSubHeaders = () => (
    <TableRow className="bg-gray-50">
      <TableHead className="h-8"></TableHead>
      <TableHead className="h-8"></TableHead>
      <TableHead className="h-8"></TableHead>
      <TableHead className="h-8"></TableHead>
      <TableHead className="h-8"></TableHead>
      <TableHead className="h-8"></TableHead>
      <TableHead className="h-8 text-xs bg-blue-50">Density g/cm³</TableHead>
      <TableHead className="h-8 text-xs bg-blue-50">UTS MPa</TableHead>
      <TableHead className="h-8 text-xs bg-blue-50">YTS MPa</TableHead>
      <TableHead className="h-8 text-xs bg-blue-50">Shear MPa</TableHead>
      <TableHead className="h-8 text-xs bg-green-50">ASTM</TableHead>
      <TableHead className="h-8 text-xs bg-green-50">DIN</TableHead>
      <TableHead className="h-8 text-xs bg-green-50">EN</TableHead>
      <TableHead className="h-8 text-xs bg-green-50">JIS</TableHead>
      <TableHead className="h-8"></TableHead>
      <TableHead className="h-8"></TableHead>
    </TableRow>
  );

  // Render plastics row
  const PlasticsRow = ({ material }: { material: MaterialProperty }) => (
    <TableRow key={material.id} className="hover:bg-gray-50">
      <TableCell>
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: material.color_code }}
          ></div>
          <span className="text-sm font-medium">{material.category_name}</span>
        </div>
      </TableCell>
      <TableCell className="font-medium">{material.material_name}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs">
          {material.material_grade || '—'}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">Granules</TableCell>
      <TableCell className="text-center">
        <Badge variant="secondary" className="text-xs">
          {material.shrinkage_rate_percent ? `${material.shrinkage_rate_percent}%` : 'Yes'}
        </Badge>
      </TableCell>
      <TableCell className="text-center font-mono">
        {formatDecimal(material.clamping_pressure_mpa, 1)}
      </TableCell>
      <TableCell className="text-center font-mono">
        {formatDecimal(material.eject_deflection_temp_celsius, 0)}
      </TableCell>
      <TableCell className="text-center font-mono">
        {formatDecimal(material.melting_temp_celsius, 0)}
      </TableCell>
      <TableCell className="text-center font-mono">
        {material.mold_temp_celsius_min ? formatDecimal(material.mold_temp_celsius_min, 0) : '—'}
      </TableCell>
      <TableCell className="text-center font-mono">
        {formatDecimal(material.density_kg_m3, 0)}
      </TableCell>
      <TableCell className="text-center font-mono">
        {formatDecimal(material.specific_heat_j_g_k, 3)}
      </TableCell>
      <TableCell className="text-center font-mono">
        {formatDecimal(material.thermal_conductivity_w_m_k, 3)}
      </TableCell>
      <TableCell className="font-mono text-green-600">
        {formatCurrency(material.cost_per_kg)}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  // Render metals row
  const MetalsRow = ({ material }: { material: MaterialProperty }) => (
    <TableRow key={material.id} className="hover:bg-gray-50">
      <TableCell>
        <div className="flex items-center gap-2">
          <div 
            className="w-3 h-3 rounded-full" 
            style={{ backgroundColor: material.color_code }}
          ></div>
          <span className="text-sm font-medium">{material.category_name}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{material.material_name}</span>
          {material.material_grade && (
            <span className="text-xs text-muted-foreground">|{material.material_grade}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">—</TableCell>
      <TableCell className="text-sm">
        <span className="text-xs bg-blue-100 px-2 py-1 rounded">
          {material.material_specification || 'High Carbon Bearing Steel'}
        </span>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">Profiles</TableCell>
      <TableCell className="text-sm text-muted-foreground">—</TableCell>
      
      {/* Properties */}
      <TableCell className="text-center font-mono bg-blue-50">
        {material.density_kg_m3 ? (material.density_kg_m3 / 1000).toFixed(2) : '—'}
      </TableCell>
      <TableCell className="text-center font-mono bg-blue-50">
        {formatDecimal(material.uts_mpa, 0)}
      </TableCell>
      <TableCell className="text-center font-mono bg-blue-50">
        {formatDecimal(material.yts_mpa, 0)}
      </TableCell>
      <TableCell className="text-center font-mono bg-blue-50">—</TableCell>
      
      {/* Standards */}
      <TableCell className="text-center text-xs bg-green-50">
        {material.material_specification ? 'ASTM A295' : '—'}
      </TableCell>
      <TableCell className="text-center text-xs bg-green-50">
        {material.material_grade ? `DIN ${material.material_grade}` : '—'}
      </TableCell>
      <TableCell className="text-center text-xs bg-green-50">
        {material.material_name}
      </TableCell>
      <TableCell className="text-center text-xs bg-green-50">SUJ2</TableCell>
      
      <TableCell className="font-mono text-green-600">
        {formatCurrency(material.cost_per_kg)}
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <Edit className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-red-600">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  // Get materials by category
  const plasticMaterials = materials.filter(m => 
    m.category_code === 'PLASTIC' || m.category_name.toLowerCase().includes('plastic')
  );
  
  const metalMaterials = materials.filter(m => 
    m.category_code === 'FERROUS' || m.category_code === 'NON_FERROUS' || 
    m.category_name.toLowerCase().includes('ferrous') || 
    m.category_name.toLowerCase().includes('metal')
  );

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl font-bold">Enhanced Raw Materials Database</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add Material
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="search">Search Materials</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search by material name, grade, or specification..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="min-w-[180px]">
              <Label htmlFor="category">Category Filter</Label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.category_code}>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full" 
                          style={{ backgroundColor: cat.color_code }}
                        ></div>
                        {cat.category_name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="icon">
              <Filter className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Plastics Table */}
      {plasticMaterials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-green-500"></div>
              Plastic & Rubber Materials
              <Badge variant="secondary">{plasticMaterials.length} items</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <PlasticsColumns />
                </TableHeader>
                <TableBody>
                  {plasticMaterials.map(material => (
                    <PlasticsRow key={material.id} material={material} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metals Table */}
      {metalMaterials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-orange-500"></div>
              Ferrous & Non-Ferrous Metals
              <Badge variant="secondary">{metalMaterials.length} items</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <MetalsColumns />
                  <MetalsSubHeaders />
                </TableHeader>
                <TableBody>
                  {metalMaterials.map(material => (
                    <MetalsRow key={material.id} material={material} />
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              Loading materials...
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && materials.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              No materials found. Add some materials to get started.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, total)} of {total} materials
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              disabled={page * limit >= total}
              onClick={() => setPage(p => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}