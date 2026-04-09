'use client';

import { useState, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { DataSource } from '@/lib/api/calculators';
import { DatabaseRecordPicker } from './DatabaseRecordPicker';
import { processesApi, type ReferenceTable } from '@/lib/api/processes';

type DatabaseFieldExtractorProps = {
  dataSource: DataSource;
  recordId?: string;
  selectedField?: string;
  lookupConfig?: Record<string, any>;
  onFieldSelect: (field: string) => void;
  onLookupConfigChange?: (config: Record<string, any>) => void;
  disabled?: boolean;
  associatedProcessId?: string;
};
// Material categories for better organization
const MATERIAL_CATEGORIES = [
  { code: 'PLASTIC_RUBBER', label: 'Plastic & Rubber', description: 'Thermoplastic and rubber-based materials' },
  { code: 'FERROUS_NON_FERROUS', label: 'Ferrous & Non-Ferrous', description: 'All metallic materials including steel and alloys' },
];

// Define available fields for each data source
const DATA_SOURCE_FIELDS: Record<DataSource, Array<{ field: string; label: string; description: string }>> = {
  mhr: [
    { field: 'totalMachineHourRate', label: 'Total MHR', description: 'Complete machine hour rate' },
    { field: 'machineName', label: 'Machine Name', description: 'Name of the machine' },
    { field: 'manufacturer', label: 'Manufacturer', description: 'Machine manufacturer' },
    { field: 'location', label: 'Location', description: 'Machine location' },
    { field: 'powerConsumption', label: 'Power Consumption', description: 'Power usage in kW' },
    { field: 'maintenanceCost', label: 'Maintenance Cost', description: 'Annual maintenance cost' },
  ],
  lhr: [
    { field: 'lhr', label: 'Labor Hour Rate', description: 'Complete labor hour rate' },
    { field: 'labourCode', label: 'Labor Code', description: 'Unique labor identifier' },
    { field: 'labourType', label: 'Labor Type', description: 'Type of labor' },
    { field: 'minimumWagePerDay', label: 'Daily Wage', description: 'Minimum wage per day' },
    { field: 'minimumWagePerMonth', label: 'Monthly Wage', description: 'Minimum wage per month' },
    { field: 'dearnessAllowance', label: 'Dearness Allowance', description: 'DA component' },
  ],
  raw_materials: [
    // Basic Material Info
    { field: 'material', label: 'Material Name', description: 'Name of the material' },
    { field: 'materialGrade', label: 'Grade', description: 'Material grade/specification' },
    { field: 'materialGroup', label: 'Group', description: 'Material category' },
    { field: 'materialType', label: 'Type', description: 'Material type classification' },
    { field: 'application', label: 'Application', description: 'Material application' },
    
    // Physical Properties
    { field: 'density', label: 'Density', description: 'Material density (g/cm³)' },
    { field: 'densityKgM3', label: 'Density (kg/m³)', description: 'Material density in kg/m³' },
    
    // Mechanical Properties
    { field: 'ultimateTensileStrength', label: 'UTS (MPa)', description: 'Ultimate tensile strength' },
    { field: 'yieldTensileStrength', label: 'YTS (MPa)', description: 'Yield tensile strength' },
    { field: 'shearingStrength', label: 'Shear Strength (MPa)', description: 'Shearing strength' },
    
    // Thermal Properties
    { field: 'meltingTempC', label: 'Melting Temp (°C)', description: 'Melting temperature' },
    { field: 'moldTempC', label: 'Mold Temp (°C)', description: 'Recommended mold temperature' },
    { field: 'ejectDeflectionTempC', label: 'Deflection Temp (°C)', description: 'Heat deflection temperature' },
    { field: 'thermalConductivityMelt', label: 'Thermal Conductivity', description: 'Thermal conductivity in melt' },
    { field: 'specificHeatMelt', label: 'Specific Heat', description: 'Specific heat in melt' },
    
    // Processing Properties
    { field: 'clampingPressureMpa', label: 'Clamping Pressure (MPa)', description: 'Required clamping pressure' },
    { field: 'regrindingPercentage', label: 'Regrind %', description: 'Regrinding percentage allowed' },
    
    // Commercial Properties
    { field: 'cost', label: 'Cost per Unit', description: 'Material cost per unit' },
    { field: 'costPerKg', label: 'Cost per KG', description: 'Price per kilogram' },
    { field: 'currency', label: 'Currency', description: 'Price currency' },
    { field: 'location', label: 'Location', description: 'Storage location' },
    { field: 'country', label: 'Country', description: 'Country of origin' },
    { field: 'shape', label: 'Shape', description: 'Material form/shape' },
    
    // Standards
    { field: 'astmStandard', label: 'ASTM Standard', description: 'ASTM standard specification' },
    { field: 'dinStandard', label: 'DIN Standard', description: 'DIN standard specification' },
    { field: 'enStandard', label: 'EN Standard', description: 'EN standard specification' },
    { field: 'jisStandard', label: 'JIS Standard', description: 'JIS standard specification' },
  ],
  processes: [
    { field: 'processName', label: 'Process Name', description: 'Name of the process' },
    { field: 'processCategory', label: 'Category', description: 'Process category' },
    { field: 'standardTimeMinutes', label: 'Standard Time', description: 'Standard time in minutes' },
    { field: 'setupTimeMinutes', label: 'Setup Time', description: 'Setup time in minutes' },
    { field: 'cycleTimeMinutes', label: 'Cycle Time', description: 'Cycle time in minutes' },
    { field: 'machineRequired', label: 'Machine Required', description: 'Whether machine is required' },
    // Reference Table Lookups
    { field: 'fromViscosity', label: 'From Viscosity', description: 'Lookup from Material Viscosity table' },
    { field: 'fromCavityPressure', label: 'From Cavity Pressure Table', description: 'Lookup from Cavity Pressure table' },
    { field: 'fromCavitiesRecommendation', label: 'From Cavities Recommendation', description: 'Lookup from Cavities Recommendation table' },
    { field: 'fromRunnerDia', label: 'From Runner Dia Table', description: 'Lookup from Runner Diameter Selection table' },
  ],
  manual: [],
};



export function DatabaseFieldExtractor({
  dataSource,
  recordId,
  selectedField,
  onFieldSelect,
  disabled = false,
  associatedProcessId,
}: DatabaseFieldExtractorProps) {
  const [availableFields, setAvailableFields] = useState<Array<{ field: string; label: string; description: string }>>([]);
  const [selectedRecord, setSelectedRecord] = useState<string>(recordId || '');
  const [referenceTables, setReferenceTables] = useState<ReferenceTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loadedProcessId, setLoadedProcessId] = useState<string | null>(null);
  const [selectedMaterialCategory, setSelectedMaterialCategory] = useState<string>('');

  // Initialize selected table from selectedField
  useEffect(() => {
    if (selectedField && selectedField.startsWith('from_')) {
      const tableId = selectedField.replace('from_', '');
      setSelectedTableId(tableId);
    } else if (!selectedField || !disabled) {
      // Only clear selection if not disabled (not saved) or no field selected
      setSelectedTableId(null);
    }
  }, [selectedField, disabled]);

  // Fetch reference tables when process ID changes
  useEffect(() => {
    const fetchReferenceTables = async () => {
      let processId = associatedProcessId || selectedRecord || recordId;

      // If we have a selected field with table ID but no process ID, try to fetch table directly
      if (!processId && selectedField && selectedField.startsWith('from_') && dataSource === 'processes') {
        const tableId = selectedField.replace('from_', '');

        try {
          const table = await processesApi.getReferenceTable(tableId);
          if (table) {
            setReferenceTables([table]);
            setLoadedProcessId(table.processId);
            return;
          }
        } catch (error) {
          console.error('❌ Failed to fetch table directly:', error);
        }
      }

      if (!processId || dataSource !== 'processes') {
        // Only clear if we're not staying with the same process
        if (loadedProcessId && dataSource !== 'processes') {
          setReferenceTables([]);
          setLoadedProcessId(null);
        }
        return;
      }

      // Don't re-fetch if we already have data for this process
      if (loadedProcessId === processId && referenceTables.length > 0) {
        return;
      }

      setTablesLoading(true);
      try {
        const tables = await processesApi.getReferenceTables(processId);
        setReferenceTables(tables);
        setLoadedProcessId(processId);
      } catch (error) {
        console.error('Failed to fetch reference tables:', error);
        setReferenceTables([]);
        setLoadedProcessId(null);
      } finally {
        setTablesLoading(false);
      }
    };

    fetchReferenceTables();
  }, [associatedProcessId, selectedRecord, recordId, dataSource, loadedProcessId, referenceTables.length]);


  useEffect(() => {
    if (dataSource && dataSource !== 'manual') {
      const baseFields = DATA_SOURCE_FIELDS[dataSource] || [];

      // When associatedProcessId is provided for processes, only show reference table fields
      if (dataSource === 'processes' && associatedProcessId) {
        // Only show dynamic reference table fields from the selected process
        const referenceFields = referenceTables.map(table => ({
          field: `from_${table.id}`,
          label: `From ${table.tableName}`,
          description: table.tableDescription || `Lookup from ${table.tableName} table`
        }));

        setAvailableFields(referenceFields);
      } else {
        // Filter out hardcoded reference table fields and add dynamic ones
        const nonReferenceFields = baseFields.filter(field =>
          !['fromViscosity', 'fromCavityPressure', 'fromCavitiesRecommendation', 'fromRunnerDia'].includes(field.field)
        );

        // Add dynamic reference table fields
        const referenceFields = referenceTables.map(table => ({
          field: `from_${table.id}`,
          label: `From ${table.tableName}`,
          description: table.tableDescription || `Lookup from ${table.tableName} table`
        }));

        setAvailableFields([...nonReferenceFields, ...referenceFields]);
      }
    } else {
      setAvailableFields([]);
    }
  }, [dataSource, referenceTables, associatedProcessId]);


  // Show actual reference table data when processes data source is selected and we have tables

  // Also show if a specific reference table field is selected (from saved state)
  const hasSelectedReferenceField = selectedField && selectedField.startsWith('from_');

  if (dataSource === 'processes' && (referenceTables.length > 0 || tablesLoading || hasSelectedReferenceField)) {

    if (tablesLoading) {
      return (
        <div className="space-y-3 pt-3 border-t border-primary/10">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-semibold">Reference Tables</Label>
          </div>
          <div className="text-sm text-muted-foreground p-4 text-center">
            Loading reference tables...
          </div>
        </div>
      );
    }

    if (referenceTables.length === 0) {
      return (
        <div className="space-y-3 pt-3 border-t border-primary/10">
          <div className="flex items-center gap-2">
            <Label className="text-xs font-semibold">Reference Tables</Label>
          </div>
          <div className="text-sm text-muted-foreground p-4 text-center">
            No reference tables found for this process. Create reference tables to use lookup functionality.
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-3 pt-3 border-t border-primary/10">
        <div className="flex items-center gap-2">
          <Label className="text-xs font-semibold">Reference Tables</Label>
        </div>

        {/* Table Selection Dropdown - only show when not disabled (editing) */}
        {!disabled && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Select Reference Table</Label>
            <Select
              value={selectedTableId || ''}
              onValueChange={(value) => {
                setSelectedTableId(value);
                onFieldSelect(`from_${value}`);
              }}
              disabled={disabled}
            >
              <SelectTrigger className={cn("h-9", disabled ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}>
                <SelectValue placeholder="Choose a reference table..." />
              </SelectTrigger>
              <SelectContent>
                {referenceTables.map((table) => (
                  <SelectItem key={table.id} value={table.id}>
                    <div className="flex items-center gap-2">
                      <span>{table.tableName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {table.rows?.length || 0} rows
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {/* Display selected table */}
          {selectedTableId && referenceTables.filter(t => t.id === selectedTableId).map((table) => (
            <div key={table.id} className="border border-border rounded-lg bg-card overflow-hidden">
              <div className="px-4 py-3 bg-primary/5">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-foreground">{table.tableName}</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{table.tableDescription}</p>
                </div>
              </div>
              <div className="border-t border-border bg-background/50 p-4">
                <div className="text-xs text-muted-foreground">
                  Table preview available in calculator preview mode
                </div>
              </div>
            </div>
          ))}

          {!selectedTableId && !disabled && (
            <div className="text-center py-8 text-muted-foreground">
              <p>Select a reference table from the dropdown above to view its data.</p>
            </div>
          )}
        </div>

      </div>
    );
  }

  if (!dataSource || dataSource === 'manual' || availableFields.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 pt-3 border-t border-primary/10">
      <div className="flex items-center gap-2">
        <Label className="text-xs font-semibold">Database Lookup Configuration</Label>
      </div>

      <div className="space-y-4">
        {/* Material Category Selection - Only show for raw_materials */}
        {dataSource === 'raw_materials' && !disabled && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Material Category</Label>
            <Select
              value={selectedMaterialCategory}
              onValueChange={(value) => {
                setSelectedMaterialCategory(value);
                setSelectedRecord(''); // Clear selected record when category changes
              }}
              disabled={disabled}
            >
              <SelectTrigger className={cn("h-9", disabled ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}>
                <SelectValue placeholder="Choose material category..." />
              </SelectTrigger>
              <SelectContent>
                {MATERIAL_CATEGORIES.map((category) => (
                  <SelectItem key={category.code} value={category.code}>
                    <div className="flex flex-col">
                      <span className="font-medium">{category.label}</span>
                      <span className="text-xs text-muted-foreground">{category.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Field Selection for Raw Materials */}
        {dataSource === 'raw_materials' && selectedMaterialCategory && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Select Property to Extract</Label>
            <Select
              value={selectedField || ''}
              onValueChange={onFieldSelect}
              disabled={disabled}
            >
              <SelectTrigger className={cn("h-9", disabled ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}>
                <SelectValue placeholder="Choose material property..." />
              </SelectTrigger>
              <SelectContent className="max-h-64 overflow-y-auto">
                {availableFields.map((field) => (
                  <SelectItem key={field.field} value={field.field}>
                    <div className="flex flex-col items-start">
                      <span className="font-medium">{field.label}</span>
                      <span className="text-xs text-muted-foreground">{field.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Record Selection - Only show for non raw_materials or when category not selected */}
        {(dataSource !== 'raw_materials' || !selectedMaterialCategory) && (
          <div className="space-y-2">
            <Label className="text-xs font-medium">Select Record/Table</Label>
            <DatabaseRecordPicker
              dataSource={dataSource}
              value={selectedRecord}
              associatedProcessId={associatedProcessId}
              onSelect={(record) => {
                setSelectedRecord(record?.id || '');
              }}
              placeholder={`Select ${dataSource.replace('_', ' ')} record...`}
              disabled={disabled}
            />
          </div>
        )}


        {/* Preview */}
        {selectedField && (
          <div className="bg-primary/5 border border-primary/10 rounded-md p-2">
            <div className="text-xs font-mono">
              <span className="text-muted-foreground">Formula:</span>{' '}
              <span className="text-primary">
                {selectedRecord
                  ? `LOOKUP("${dataSource}", "${selectedRecord}", "${selectedField}")`
                  : `LOOKUP("${dataSource}", "<record_id>", "${selectedField}")`
                }
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
