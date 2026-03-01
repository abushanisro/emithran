'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type ReferenceTableRow = {
  id?: string;
  [key: string]: any;
};

type ReferenceTable = {
  id?: string;
  table_name: string;
  table_description: string;
  column_definitions: Array<{
    name: string;
    type: string;
    label: string;
    unit?: string;
  }>;
  rows?: ReferenceTableRow[];
};

type InlineReferenceTableEditorProps = {
  processId: string;
  processName: string;
  tables: ReferenceTable[];
  onTablesChange: (tables: ReferenceTable[]) => void;
  onSave: (tables: ReferenceTable[]) => Promise<void>;
  onViewTables?: () => void; // Optional callback to switch back to view mode
};

export function InlineReferenceTableEditor({
  processName,
  tables,
  onTablesChange,
  onSave,
  onViewTables
}: InlineReferenceTableEditorProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTable, setNewTable] = useState<ReferenceTable>({
    table_name: '',
    table_description: '',
    column_definitions: [],
    rows: []
  });
  const [isSaving, setIsSaving] = useState(false);

  const predefinedTables = [
    {
      table_name: 'Runner Diameter Selection',
      table_description: 'Part weight to runner diameter mapping',
      column_definitions: [
        { name: 'part_weight', type: 'text', label: 'Part Weight (gram)', unit: 'g' },
        { name: 'diameter', type: 'number', label: 'Runner Diameter', unit: 'mm' }
      ],
      rows: [
        { part_weight: '<=0', diameter: 0 },
        { part_weight: '<=20', diameter: 3 },
        { part_weight: '<=50', diameter: 4 },
        { part_weight: '<=100', diameter: 5 },
        { part_weight: '<=250', diameter: 6 },
        { part_weight: 'Above', diameter: 7 },
      ]
    },
    {
      table_name: 'Cavities Recommendation',
      table_description: 'EAU to cavities recommendation mapping',
      column_definitions: [
        { name: 'eau', type: 'text', label: 'EAU Range', unit: '' },
        { name: 'cavities', type: 'number', label: 'Recommended Cavities', unit: '' }
      ],
      rows: [
        { eau: '50,000', cavities: 1 },
        { eau: '50,000 - 2,00,000', cavities: 2 },
        { eau: '2,00,000 - 6,00,000', cavities: 4 },
        { eau: '6,00,000 - 30,00,000', cavities: 8 },
        { eau: '30,00,000 - 1,00,00,000', cavities: 16 },
        { eau: '1,00,00,000 >', cavities: 32 },
      ]
    },
    {
      table_name: 'Cavity Pressure Table',
      table_description: 'Flow path to cavity pressure mapping',
      column_definitions: [
        { name: 'flow_path_ratio', type: 'number', label: 'Flow Path to Thickness', unit: '' },
        { name: 'cavity_pressure', type: 'number', label: 'Cavity Pressure', unit: 'Bar' }
      ],
      rows: [
        { flow_path_ratio: 50, cavity_pressure: 100 },
        { flow_path_ratio: 60, cavity_pressure: 110 },
        { flow_path_ratio: 70, cavity_pressure: 120 },
        { flow_path_ratio: 80, cavity_pressure: 130 },
        { flow_path_ratio: 90, cavity_pressure: 140 },
        { flow_path_ratio: 100, cavity_pressure: 150 },
        { flow_path_ratio: 110, cavity_pressure: 160 },
        { flow_path_ratio: 120, cavity_pressure: 170 },
        { flow_path_ratio: 130, cavity_pressure: 180 },
        { flow_path_ratio: 140, cavity_pressure: 190 },
        { flow_path_ratio: 150, cavity_pressure: 200 },
        { flow_path_ratio: 160, cavity_pressure: 206 },
        { flow_path_ratio: 170, cavity_pressure: 212 },
        { flow_path_ratio: 180, cavity_pressure: 218 },
        { flow_path_ratio: 190, cavity_pressure: 224 },
        { flow_path_ratio: 200, cavity_pressure: 230 },
        { flow_path_ratio: 210, cavity_pressure: 244 },
        { flow_path_ratio: 220, cavity_pressure: 258 },
        { flow_path_ratio: 230, cavity_pressure: 272 },
        { flow_path_ratio: 240, cavity_pressure: 286 },
        { flow_path_ratio: 250, cavity_pressure: 300 },
        { flow_path_ratio: 260, cavity_pressure: 350 },
        { flow_path_ratio: 270, cavity_pressure: 400 },
        { flow_path_ratio: 280, cavity_pressure: 405 },
        { flow_path_ratio: 290, cavity_pressure: 410 },
        { flow_path_ratio: 300, cavity_pressure: 420 },
      ]
    },
    {
      table_name: 'Material Viscosity',
      table_description: 'Material types and their viscosity grades',
      column_definitions: [
        { name: 'material', type: 'text', label: 'Material', unit: '' },
        { name: 'viscosity', type: 'number', label: 'Viscosity Grade', unit: 'K' }
      ],
      rows: [
        { material: 'GPPS', viscosity: 1.00 },
        { material: 'TPS', viscosity: 1.00 },
        { material: 'PE', viscosity: 1.00 },
        { material: 'HIPS', viscosity: 1.00 },
        { material: 'PS', viscosity: 1.00 },
        { material: 'PP', viscosity: 1.00 },
        { material: 'PA', viscosity: 1.33 },
        { material: 'PETP', viscosity: 1.33 },
        { material: 'PBT', viscosity: 1.33 },
        { material: 'CAB', viscosity: 1.40 },
        { material: 'CP', viscosity: 1.40 },
        { material: 'PEEL', viscosity: 1.40 },
        { material: 'TPU', viscosity: 1.40 },
        { material: 'CA', viscosity: 1.40 },
        { material: 'CAP', viscosity: 1.40 },
        { material: 'EVA', viscosity: 1.40 },
        { material: 'PUR', viscosity: 1.40 },
        { material: 'PPVC', viscosity: 1.40 },
        { material: 'ABS', viscosity: 1.50 },
        { material: 'ASA', viscosity: 1.50 },
        { material: 'MBS', viscosity: 1.50 },
        { material: 'PPOM', viscosity: 1.50 },
        { material: 'POM', viscosity: 1.50 },
        { material: 'SAN', viscosity: 1.50 },
        { material: 'PPS', viscosity: 1.50 },
        { material: 'BDS', viscosity: 1.50 },
        { material: 'PC', viscosity: 1.61 },
        { material: 'PC/PBT', viscosity: 1.61 },
        { material: 'PMMA', viscosity: 1.61 },
        { material: 'PC/ABS', viscosity: 1.61 },
        { material: 'PES', viscosity: 1.80 },
        { material: 'PEI', viscosity: 1.80 },
        { material: 'PSU', viscosity: 1.80 },
        { material: 'PEEK', viscosity: 1.80 },
        { material: 'Add Fiber Glass', viscosity: 1.80 },
        { material: 'Other Engineering Plastic', viscosity: 1.80 },
      ]
    }
  ];

  const handleCreateTable = () => {
    setIsCreating(true);
    setNewTable({
      table_name: '',
      table_description: '',
      column_definitions: [
        { name: 'parameter', type: 'text', label: 'Parameter' },
        { name: 'value', type: 'number', label: 'Value', unit: '' },
      ],
      rows: []
    });
  };

  const handleCreatePredefinedTable = (predefinedTable: ReferenceTable) => {
    const tableWithId = {
      ...predefinedTable,
      id: `temp-${Date.now()}`,
    };

    onTablesChange([...tables, tableWithId]);
  };

  const handleSaveNewTable = () => {
    if (!newTable.table_name.trim()) return;

    const tableWithId = {
      ...newTable,
      id: `temp-${Date.now()}`,
      rows: [
        // Add one sample row
        newTable.column_definitions.reduce((acc, col) => {
          acc[col.name] = col.type === 'number' ? 0 : '';
          return acc;
        }, {} as ReferenceTableRow)
      ]
    };

    onTablesChange([...tables, tableWithId]);
    setIsCreating(false);
    setNewTable({ table_name: '', table_description: '', column_definitions: [], rows: [] });
  };

  const handleDeleteTable = (tableIndex: number) => {
    const updatedTables = tables.filter((_, i) => i !== tableIndex);
    onTablesChange(updatedTables);
  };

  const handleAddColumn = () => {
    setNewTable({
      ...newTable,
      column_definitions: [
        ...newTable.column_definitions,
        { name: '', type: 'text', label: '' }
      ]
    });
  };

  const handleUpdateColumn = (index: number, field: string, value: string) => {
    const updatedColumns = [...newTable.column_definitions];
    updatedColumns[index] = { ...updatedColumns[index], [field]: value } as ReferenceTable['column_definitions'][number];
    setNewTable({ ...newTable, column_definitions: updatedColumns });
  };

  const handleAddRow = (tableIndex: number) => {
    const updatedTables = [...tables];
    const table = updatedTables[tableIndex]!;
    const newRow = table.column_definitions.reduce((acc, col) => {
      acc[col.name] = col.type === 'number' ? 0 : '';
      return acc;
    }, {} as ReferenceTableRow);

    table.rows = [...(table.rows || []), newRow];
    onTablesChange(updatedTables);
  };

  const handleUpdateRow = (tableIndex: number, rowIndex: number, field: string, value: any) => {
    const updatedTables = [...tables];
    const table = updatedTables[tableIndex]!;
    if (!table.rows) table.rows = [];

    table.rows[rowIndex] = { ...table.rows[rowIndex], [field]: value };
    onTablesChange(updatedTables);
  };

  const handleSaveAll = async () => {
    setIsSaving(true);
    try {
      await onSave(tables);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-3 rounded-lg border border-border bg-background">
      {/* Ultra Compact Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h3 className="text-xs font-semibold text-foreground">{processName} - Reference Tables</h3>
          <p className="text-xs text-muted-foreground">
            Compact lookup tables for calculator fields
          </p>
        </div>
        <div className="flex items-center gap-1">
          {tables.length > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0 bg-secondary text-muted-foreground border-border">
              {tables.length}
            </Badge>
          )}
          {onViewTables && (
            <Button variant="ghost" size="sm" onClick={onViewTables} className="h-6 px-2 text-muted-foreground hover:text-primary hover:bg-secondary">
              <svg className="h-2.5 w-2.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="text-xs">View</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleCreateTable} className="h-6 px-2 border-border text-foreground hover:bg-secondary hover:border-primary/40">
            <Plus className="h-2.5 w-2.5 mr-1" />
            <span className="text-xs">Add</span>
          </Button>
          {tables.length > 0 && (
            <Button onClick={handleSaveAll} disabled={isSaving} size="sm" className="h-6 px-2 bg-primary hover:bg-primary/90 text-primary-foreground">
              <Save className="h-2.5 w-2.5 mr-1" />
              <span className="text-xs">{isSaving ? 'Saving...' : 'Save'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Create New Table */}
      {isCreating && (
        <Card className="border-primary/20 bg-card">
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm">Create New Reference Table</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1 block">Table Name</Label>
                <Input
                  className="h-7 text-xs"
                  value={newTable.table_name}
                  onChange={(e) => setNewTable({ ...newTable, table_name: e.target.value })}
                  placeholder="e.g., Material Properties"
                />
              </div>
              <div>
                <Label className="text-xs mb-1 block">Description</Label>
                <Textarea
                  className="text-xs min-h-0 py-1"
                  value={newTable.table_description}
                  onChange={(e) => setNewTable({ ...newTable, table_description: e.target.value })}
                  placeholder="Brief description of this table"
                  rows={1}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Columns</Label>
              <div className="space-y-1.5">
                {newTable.column_definitions.map((col, idx) => (
                  <div key={idx} className="grid grid-cols-4 gap-1.5 p-1.5 border border-border rounded bg-secondary/30">
                    <Input className="h-6 text-xs" placeholder="Column name" value={col.name} onChange={(e) => handleUpdateColumn(idx, 'name', e.target.value)} />
                    <Input className="h-6 text-xs" placeholder="Display label" value={col.label} onChange={(e) => handleUpdateColumn(idx, 'label', e.target.value)} />
                    <select
                      value={col.type}
                      onChange={(e) => handleUpdateColumn(idx, 'type', e.target.value)}
                      className="h-6 px-1.5 border border-input rounded text-xs bg-background text-foreground"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                    </select>
                    <Input className="h-6 text-xs" placeholder="Unit (optional)" value={col.unit || ''} onChange={(e) => handleUpdateColumn(idx, 'unit', e.target.value)} />
                  </div>
                ))}
                <Button variant="ghost" size="sm" onClick={handleAddColumn} className="h-6 text-xs text-muted-foreground hover:text-primary">
                  <Plus className="h-3 w-3 mr-1" />
                  Add Column
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" onClick={handleSaveNewTable} disabled={!newTable.table_name.trim()}>
                Create Table
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setIsCreating(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Compact Empty State with Predefined Tables */}
      {tables.length === 0 && !isCreating ? (
        <Card className="border-dashed border-border bg-card">
          <CardContent className="py-4">
            <div className="text-center mb-3">
              <h4 className="font-medium text-foreground text-xs mb-1">No Reference Tables Yet</h4>
              <p className="text-xs text-muted-foreground">
                Start with predefined tables or create custom ones
              </p>
            </div>

            {/* Compact Quick Select */}
            <div className="mb-3">
              <h5 className="text-xs font-medium mb-1.5 text-left text-muted-foreground">Quick Start - Injection Molding:</h5>
              <div className="grid grid-cols-2 gap-1.5">
                {predefinedTables.map((table, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    className="h-auto p-2 justify-start text-left border-border hover:border-primary/40 hover:bg-secondary"
                    onClick={() => handleCreatePredefinedTable(table)}
                  >
                    <div className="flex-1">
                      <div className="font-medium text-xs mb-0.5 text-foreground">{table.table_name}</div>
                      <div className="text-xs text-muted-foreground leading-tight">{table.table_description}</div>
                      <div className="text-xs text-primary mt-0.5">{table.rows?.length || 0} rows</div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>

            {/* Compact Custom Option */}
            <div className="border-t border-border pt-2.5">
              <Button onClick={handleCreateTable} className="w-full h-7" variant="default">
                <Plus className="h-3 w-3 mr-1.5" />
                <span className="text-xs">Create Custom Table</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tables.map((table, tableIndex) => (
            <div key={table.id || tableIndex} className="border border-border rounded-lg bg-card shadow-sm">
              {/* Ultra Compact Header */}
              <div className="flex items-center justify-between px-2.5 py-1.5 bg-secondary/40 border-b border-border rounded-t-lg">
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-semibold text-foreground truncate">{table.table_name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{table.table_description}</p>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <Badge variant="outline" className="text-xs px-1.5 py-0 border-border text-muted-foreground">
                    {table.rows?.length || 0}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteTable(tableIndex)}
                    className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    title="Delete table"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              </div>

              {/* Table Content */}
              <div className="p-1">
                {table.rows && table.rows.length > 0 ? (
                  <div className="overflow-x-auto border rounded border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-secondary/80 sticky top-0">
                        <tr>
                          <th className="w-6 border border-border bg-secondary/60 text-center text-sm font-medium py-0.5 px-1 text-muted-foreground">
                            #
                          </th>
                          {table.column_definitions.map((col) => (
                            <th key={col.name} className="border border-border text-left text-sm font-medium py-0.5 px-2 bg-secondary/40 text-foreground">
                              <div className="truncate" title={col.label}>
                                {col.label}
                                {col.unit && <span className="text-primary/70 text-sm"> ({col.unit})</span>}
                              </div>
                            </th>
                          ))}
                          <th className="w-7 border border-border bg-secondary/60">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleAddRow(tableIndex)}
                              className="h-4 w-4 p-0 hover:bg-primary/10 text-primary"
                              title="Add row"
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </Button>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.map((row, rowIndex) => (
                          <tr key={rowIndex} className="hover:bg-secondary/20">
                            <td className="border border-border bg-secondary/30 text-center text-sm py-0 px-1 font-mono text-muted-foreground">
                              {rowIndex + 1}
                            </td>
                            {table.column_definitions.map((col) => (
                              <td key={col.name} className="border border-border p-0 bg-transparent">
                                <input
                                  type={col.type === 'number' ? 'number' : 'text'}
                                  value={row[col.name] || ''}
                                  onChange={(e) => handleUpdateRow(
                                    tableIndex,
                                    rowIndex,
                                    col.name,
                                    col.type === 'number' ? Number(e.target.value) : e.target.value
                                  )}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Tab' || e.key === 'Enter') {
                                      e.preventDefault();
                                      const nextCell = e.key === 'Tab'
                                        ? e.currentTarget.parentElement?.nextElementSibling?.querySelector('input')
                                        : e.currentTarget.closest('tr')?.nextElementSibling?.querySelector('input');
                                      nextCell?.focus();
                                    }
                                  }}
                                  className="w-full h-6 px-2 py-0 text-sm border-0 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:ring-inset bg-transparent hover:bg-secondary/30 focus:bg-secondary/50 transition-colors text-foreground placeholder:text-muted-foreground/40"
                                  placeholder={col.type === 'number' ? '0' : ''}
                                />
                              </td>
                            ))}
                            <td className="border border-border text-center p-0 bg-secondary/30">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const updatedTables = [...tables];
                                  updatedTables[tableIndex]!.rows?.splice(rowIndex, 1);
                                  onTablesChange(updatedTables);
                                }}
                                className="h-5 w-5 p-0 hover:bg-destructive/10 hover:text-destructive text-muted-foreground/60"
                                title="Delete row"
                              >
                                <X className="h-2.5 w-2.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-2.5 text-muted-foreground">
                    <p className="text-xs mb-1.5">No data rows yet</p>
                    <Button variant="outline" size="sm" onClick={() => handleAddRow(tableIndex)} className="h-6 border-border text-foreground hover:bg-secondary hover:border-primary/40">
                      <Plus className="h-2.5 w-2.5 mr-1" />
                      <span className="text-xs">Add First Row</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )
      }
    </div >
  );
}