'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Edit2, Trash2, Plus, Save, XCircle, Loader2, Settings, Search, Database } from 'lucide-react';
import {
  useProcesses,
  useReferenceTables,
  useBulkUpdateTableRows,
  type ReferenceTable,
} from '@/lib/api/hooks/useProcesses';
import {
  useProcessCalculatorMappings,
  useCreateProcessCalculatorMapping,
  useUpdateProcessCalculatorMapping,
  useDeleteProcessCalculatorMapping,
  useProcessHierarchy,
  type ProcessCalculatorMapping,
} from '@/lib/api/hooks/useProcessCalculatorMappings';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { InlineReferenceTableEditor } from '@/components/features/calculators/builder/InlineReferenceTableEditor';
import { useAuth } from '@/lib/providers/auth';

// Helper function to convert snake_case to camelCase
const snakeToCamel = (str: string): string => {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
};

// Helper function to get value from row data with fallback for both naming conventions
const getRowValue = (row: any, columnName: string): any => {
  // Try exact match first
  if (row[columnName] !== undefined) {
    return row[columnName];
  }

  // Try camelCase version
  const camelCaseName = snakeToCamel(columnName);
  if (row[camelCaseName] !== undefined) {
    return row[camelCaseName];
  }

  // Return undefined if neither exists
  return undefined;
};

export default function ProcessPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const [editingTableId, setEditingTableId] = useState<string | null>(null);
  const [editedTableData, setEditedTableData] = useState<Record<string, any[]>>({});

  // Calculator Mapping States
  const [isAddMappingDialogOpen, setIsAddMappingDialogOpen] = useState(false);
  const [editingMapping, setEditingMapping] = useState<ProcessCalculatorMapping | null>(null);
  const [mappingFormData, setMappingFormData] = useState({
    processGroup: '',
    processRoute: '',
    operation: '',
    calculatorName: '',
  });

  // Filter states
  const [filterProcessGroup, setFilterProcessGroup] = useState<string>('');
  const [filterProcessRoute, setFilterProcessRoute] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // State for lookup table modal
  const [isLookupTableModalOpen, setIsLookupTableModalOpen] = useState(false);
  const [modalProcessId, setModalProcessId] = useState<string | null>(null);
  const [modalProcessName, setModalProcessName] = useState<string>('');

  const [inlineEditorTables, setInlineEditorTables] = useState<any[]>([]);
  const [expandedTableId, setExpandedTableId] = useState<string | null>(null);
  const [showAddTableEditor, setShowAddTableEditor] = useState(false);

  // Reset process route filter when process group changes
  const handleProcessGroupChange = (value: string) => {
    setFilterProcessGroup(value);
    if (value === 'all' || !value) {
      setFilterProcessRoute('all');
    }
  };

  // Fetch processes from database
  const { data: processesData, isLoading: processesLoading, error: processesError } = useProcesses();

  // Fetch reference tables for selected process (from old functionality)
  const { data: referenceTables, isLoading: loadingTables } = useReferenceTables(selectedProcessId || undefined);

  // Fetch reference tables for modal process (only if modalProcessId is a valid UUID)
  const { data: modalReferenceTables, isLoading: loadingModalTables, refetch: refetchModalTables } = useReferenceTables(
    modalProcessId && modalProcessId !== 'test' ? modalProcessId : undefined
  );

  // Fetch calculator mappings with filters
  const { data: calculatorMappings, isLoading: loadingMappings } = useProcessCalculatorMappings({
    processGroup: filterProcessGroup && filterProcessGroup !== 'all' ? filterProcessGroup : undefined,
    processRoute: filterProcessRoute && filterProcessRoute !== 'all' ? filterProcessRoute : undefined,
    search: searchQuery || undefined,
    limit: 1000,
  });
  const { data: hierarchy } = useProcessHierarchy();


  // Bulk update mutation
  const bulkUpdateMutation = useBulkUpdateTableRows();

  // Calculator mapping mutations
  const createMappingMutation = useCreateProcessCalculatorMapping();
  const updateMappingMutation = useUpdateProcessCalculatorMapping();
  const deleteMappingMutation = useDeleteProcessCalculatorMapping();

  const handleEditTable = (tableId: string) => {
    setEditingTableId(tableId);
    // Initialize edited data with current table rows
    const table = referenceTables?.find(t => t.id === tableId);
    if (table?.rows) {
      setEditedTableData({
        ...editedTableData,
        [tableId]: table.rows.map(row => {
          const rowData = (row as any).row_data || row.rowData || {};

          // Normalize data to have both snake_case and camelCase keys
          const normalizedData: any = { ...rowData };

          // For each column definition, ensure both naming conventions exist
          table.columnDefinitions.forEach(col => {
            const snakeCase = col.name;
            const camelCase = snakeToCamel(col.name);

            // If we have the value in either format, copy to both
            if (rowData[snakeCase] !== undefined) {
              normalizedData[camelCase] = rowData[snakeCase];
            } else if (rowData[camelCase] !== undefined) {
              normalizedData[snakeCase] = rowData[camelCase];
            }
          });

          return {
            ...normalizedData,
            _id: row.id,
            _order: (row as any).row_order || row.rowOrder
          };
        })
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingTableId(null);
    setEditedTableData({});
  };

  const handleSaveTable = async (tableId: string) => {
    const tableData = editedTableData[tableId];
    if (!tableData) return;

    // Convert to the format expected by the API
    const rows = tableData.map((row, index) => ({
      row_data: Object.fromEntries(
        Object.entries(row).filter(([key]) => !key.startsWith('_'))
      ),
      row_order: index
    }));

    try {
      await bulkUpdateMutation.mutateAsync({ tableId, rows });
      setEditingTableId(null);
      setEditedTableData({});
    } catch (error) {
      // Failed to save table
    }
  };

  // Generic handlers for any table
  const handleAddRow = (tableId: string) => {
    const table = referenceTables?.find(t => t.id === tableId);
    if (!table) return;

    // Create empty row based on column definitions with both naming conventions
    const newRow: Record<string, any> = {};
    table.columnDefinitions.forEach(col => {
      const defaultValue = col.type === 'number' ? 0 : '';
      newRow[col.name] = defaultValue;  // snake_case
      newRow[snakeToCamel(col.name)] = defaultValue;  // camelCase
    });

    const currentData = editedTableData[tableId] || [];
    setEditedTableData({
      ...editedTableData,
      [tableId]: [...currentData, newRow]
    });
  };

  const handleDeleteRow = (tableId: string, index: number) => {
    const currentData = editedTableData[tableId] || [];
    setEditedTableData({
      ...editedTableData,
      [tableId]: currentData.filter((_, i) => i !== index)
    });
  };

  const handleUpdateRow = (tableId: string, index: number, field: string, value: any, fieldType?: string) => {
    const currentData = editedTableData[tableId] || [];
    const updated = [...currentData];

    // Store in both snake_case and camelCase for compatibility
    const camelCaseField = snakeToCamel(field);
    const processedValue = fieldType === 'number' ? Number(value) : value;

    updated[index] = {
      ...updated[index],
      [field]: processedValue,  // snake_case (for backend)
      [camelCaseField]: processedValue  // camelCase (for display)
    };

    setEditedTableData({
      ...editedTableData,
      [tableId]: updated
    });
  };

  const renderEditableTable = (table: ReferenceTable) => {
    const isEditing = editingTableId === table.id;

    // Enhanced data mapping - handle both snake_case and camelCase
    const mapRowData = (row: any) => {
      // Try row_data (snake_case from DB) first, then rowData (camelCase)
      const rowData = row.row_data || row.rowData || row;

      // Handle empty row data
      if (!rowData || Object.keys(rowData).length === 0) {
        // Row data is empty or malformed
      }

      return rowData;
    };

    const displayData = isEditing
      ? (editedTableData[table.id] || table.rows?.map(mapRowData) || [])
      : (table.rows?.map(mapRowData) || []);

    return (
      <Card key={table.id}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{table.tableName}</CardTitle>
              {table.tableDescription && (
                <CardDescription>{table.tableDescription}</CardDescription>
              )}
            </div>
            <div className="flex gap-2">
              {!isEditing ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditTable(table.id)}
                  disabled={!table.isEditable}
                >
                  <Edit2 className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelEdit}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleSaveTable(table.id)}
                    disabled={bulkUpdateMutation.isPending}
                  >
                    {bulkUpdateMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    Save
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-96">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columnDefinitions.map((col, colIdx) => (
                    <TableHead key={col.name} className={colIdx !== 0 ? 'text-right' : ''}>
                      {col.label}
                    </TableHead>
                  ))}
                  {isEditing && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={table.columnDefinitions.length + (isEditing ? 1 : 0)} className="text-center text-muted-foreground">
                      No data available
                    </TableCell>
                  </TableRow>
                ) : (
                  displayData.map((row, idx) => (
                    <TableRow key={idx}>
                      {table.columnDefinitions.map((col, colIdx) => {
                        const cellValue = getRowValue(row, col.name);
                        return (
                          <TableCell key={col.name} className={colIdx !== 0 ? 'text-right' : ''}>
                            {isEditing ? (
                              <Input
                                type={col.type === 'number' ? 'number' : 'text'}
                                value={cellValue ?? ''}
                                onChange={(e) => handleUpdateRow(table.id, idx, col.name, e.target.value, col.type)}
                                className="h-8"
                              />
                            ) : (
                              <span className={colIdx === 0 ? 'font-medium' : ''}>
                                {cellValue}
                              </span>
                            )}
                          </TableCell>
                        );
                      })}
                      {isEditing && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteRow(table.id, idx)}
                            className="h-8 w-8 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {isEditing && (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAddRow(table.id)}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Add New Row
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Calculator Mapping Handlers
  const handleAddMapping = () => {
    setEditingMapping(null);
    setMappingFormData({
      processGroup: '',
      processRoute: '',
      operation: '',
      calculatorName: '',
    });
    setIsAddMappingDialogOpen(true);
  };

  const handleEditMapping = (mapping: ProcessCalculatorMapping) => {
    setEditingMapping(mapping);
    setMappingFormData({
      processGroup: mapping.processGroup,
      processRoute: mapping.processRoute,
      operation: mapping.operation,
      calculatorName: mapping.calculatorName || '',
    });
    setIsAddMappingDialogOpen(true);
  };

  const handleSaveMapping = async () => {
    try {
      if (editingMapping) {
        await updateMappingMutation.mutateAsync({
          id: editingMapping.id,
          data: mappingFormData,
        });
        toast.success('Calculator mapping updated successfully');
      } else {
        await createMappingMutation.mutateAsync(mappingFormData);
        toast.success('Calculator mapping created successfully');
      }
      setIsAddMappingDialogOpen(false);
    } catch (error) {
      toast.error('Failed to save calculator mapping');
    }
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Are you sure you want to delete this calculator mapping?')) return;

    try {
      await deleteMappingMutation.mutateAsync(id);
      toast.success('Calculator mapping deleted successfully');
    } catch (error) {
      toast.error('Failed to delete calculator mapping');
    }
  };

  const renderProcessTables = () => {
    if (!selectedProcessId) return null;

    const processes = processesData?.processes || [];
    const process = processes.find(p => p.id === selectedProcessId);
    if (!process) return null;

    return (
      <Card className="mt-6 border-2 border-primary">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">{process.processName} - Reference Tables</CardTitle>
              <CardDescription>Click Edit to modify tables, add or remove rows</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSelectedProcessId(null)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingTables ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading reference tables...</span>
            </div>
          ) : referenceTables && referenceTables.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {referenceTables.map((table) => renderEditableTable(table))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>No reference tables found for this process.</p>
              <p className="text-sm mt-2">Reference tables can be added via the database migration.</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // Show loading spinner during auth initialization
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect if not authenticated
  if (!user) {
    router.push('/auth/login');
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="m12 19-7-7 7-7"></path>
            <path d="M19 12H5"></path>
          </svg>
        </Button>
        <PageHeader
          title="Process"
          description="Manage processes, calculator mappings, and detailed specifications"
        />
      </div>

      <div className="space-y-6">
        {/* CALCULATOR MAPPINGS */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Process Calculator Mappings
                </CardTitle>
                <CardDescription>
                  Define which calculator is used for each process group, route, and operation combination
                </CardDescription>
              </div>
              <Button onClick={handleAddMapping}>
                <Plus className="h-4 w-4 mr-2" />
                Add Mapping
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Search bar */}
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="filter-search"
                  placeholder="Search groups, routes or operations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              {searchQuery && (
                <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')} className="h-9">
                  <X className="h-4 w-4 mr-1" /> Clear
                </Button>
              )}
              {calculatorMappings && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {calculatorMappings.mappings.length} operations ·{' '}
                  {Object.keys(calculatorMappings.mappings.reduce((g: any, m) => { g[m.processGroup] = true; return g; }, {})).length} groups
                </span>
              )}
            </div>
            {/* GROUPED TREE VIEW */}
            {loadingMappings ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">Loading...</span>
              </div>
            ) : (() => {
              const allMappings = calculatorMappings?.mappings ?? [];
              const q = searchQuery.toLowerCase();
              const filtered = q
                ? allMappings.filter(m =>
                  m.processGroup.toLowerCase().includes(q) ||
                  m.processRoute.toLowerCase().includes(q) ||
                  m.operation.toLowerCase().includes(q)
                )
                : allMappings;

              const grouped: Record<string, Record<string, typeof allMappings>> = {};
              for (const m of filtered) {
                if (!grouped[m.processGroup]) grouped[m.processGroup] = {};
                if (!grouped[m.processGroup][m.processRoute]) grouped[m.processGroup][m.processRoute] = [];
                grouped[m.processGroup][m.processRoute].push(m);
              }

              if (filtered.length === 0) {
                return (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="font-medium">No mappings found</p>
                    <p className="text-sm mt-1">Try a different search or add a new mapping</p>
                  </div>
                );
              }

              return (
                <div className="space-y-2">
                  {Object.entries(grouped).map(([group, routes]) => (
                    <div key={group} className="border border-border rounded-lg overflow-hidden">
                      {/* Process Group header */}
                      <div className="px-4 py-2.5 bg-secondary/50 border-b border-border flex items-center justify-between">
                        <h3 className="font-semibold text-sm text-foreground">{group}</h3>
                        <Badge variant="outline" className="text-xs">
                          {Object.values(routes).flat().length} ops · {Object.keys(routes).length} routes
                        </Badge>
                      </div>
                      {/* Process Routes */}
                      <div className="divide-y divide-border/40">
                        {Object.entries(routes).map(([route, ops]) => (
                          <div key={route} className="px-4 py-2 flex items-start gap-4 hover:bg-secondary/10 transition-colors">
                            {/* Route — clickable to open reference tables modal */}
                            <button
                              className="text-sm font-medium text-primary hover:underline w-44 shrink-0 text-left pt-0.5"
                              title="Click to view / edit reference tables"
                              onClick={() => {
                                const processes = processesData?.processes || [];
                                let process = processes.find(p => p.processName === route);
                                if (!process) process = processes.find(p => p.processName.toLowerCase() === route.toLowerCase());
                                setModalProcessId(process?.id ?? null);
                                setModalProcessName(route);
                                setInlineEditorTables([]);
                                setShowAddTableEditor(false);
                                setExpandedTableId(null);
                                setIsLookupTableModalOpen(true);
                              }}
                            >
                              {route}
                            </button>
                            {/* Operations as pill chips */}
                            <div className="flex flex-wrap gap-1.5 flex-1">
                              {ops.map((op) => (
                                <div
                                  key={op.id}
                                  className="flex items-center gap-1 bg-secondary/40 border border-border rounded-full px-2.5 py-0.5 group"
                                >
                                  <span className="text-xs text-foreground">{op.operation}</span>
                                  <button
                                    className="h-3.5 w-3.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary flex items-center justify-center"
                                    onClick={() => {
                                      router.push(`/calculators?processGroup=${encodeURIComponent(op.processGroup)}&processRoute=${encodeURIComponent(op.processRoute)}&operation=${encodeURIComponent(op.operation)}`);
                                    }}
                                    title="View Calculators"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5">
                                      <rect x="4" y="3" width="16" height="2" rx="1"/>
                                      <rect x="4" y="7" width="16" height="2" rx="1"/>
                                      <rect x="4" y="11" width="16" height="2" rx="1"/>
                                      <rect x="4" y="15" width="16" height="2" rx="1"/>
                                      <rect x="4" y="19" width="16" height="2" rx="1"/>
                                    </svg>
                                  </button>
                                  <button
                                    className="h-3.5 w-3.5 ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground flex items-center justify-center"
                                    onClick={() => handleEditMapping(op)}
                                    title="Edit"
                                  >
                                    <Edit2 className="h-2.5 w-2.5" />
                                  </button>
                                  <button
                                    className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex items-center justify-center"
                                    onClick={() => handleDeleteMapping(op.id)}
                                    title="Delete"
                                  >
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* STATUS INFO */}
        {processesLoading && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <p className="text-blue-800">Loading manufacturing processes...</p>
            </CardContent>
          </Card>
        )}

        {processesError && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="p-4">
              <p className="text-red-800">Error loading processes: {processesError.message}</p>
              <p className="text-sm text-red-600 mt-2">
                This page loads general manufacturing processes. If you're looking for production lot processes,
                navigate to a specific production lot instead.
              </p>
            </CardContent>
          </Card>
        )}

        {!processesLoading && !processesError && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4">
              <p className="text-amber-800">
                <strong>Note:</strong> This page shows general manufacturing process templates and calculator mappings.
              </p>
              <p className="text-sm text-amber-600 mt-1">
                For production lot-specific processes, navigate to Production Planning → select a lot.
              </p>
              {processesData?.processes && processesData.processes.length > 0 && (
                <p className="text-sm text-green-600 mt-2">
                  Found {processesData.processes.length} process templates
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* PROCESS-SPECIFIC TABLES */}
        {renderProcessTables()}
      </div>

      {/* ADD/EDIT CALCULATOR MAPPING DIALOG */}
      <Dialog open={isAddMappingDialogOpen} onOpenChange={setIsAddMappingDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingMapping ? 'Edit' : 'Add'} Calculator Mapping</DialogTitle>
            <DialogDescription>
              Define the relationship between process hierarchy and calculator
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="processGroup">Process Group</Label>
              <Input
                id="processGroup"
                value={mappingFormData.processGroup}
                onChange={(e) =>
                  setMappingFormData({ ...mappingFormData, processGroup: e.target.value })
                }
                placeholder="e.g., Plastic & Rubber"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="processRoute">Process Route</Label>
              <Input
                id="processRoute"
                value={mappingFormData.processRoute}
                onChange={(e) =>
                  setMappingFormData({ ...mappingFormData, processRoute: e.target.value })
                }
                placeholder="e.g., Injection Molding"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="operation">Operation</Label>
              <Input
                id="operation"
                value={mappingFormData.operation}
                onChange={(e) =>
                  setMappingFormData({ ...mappingFormData, operation: e.target.value })
                }
                placeholder="e.g., Injection Molding-Cold Runner"
              />
            </div>

          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddMappingDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveMapping}
              disabled={
                !mappingFormData.processGroup ||
                !mappingFormData.processRoute ||
                !mappingFormData.operation ||
                createMappingMutation.isPending ||
                updateMappingMutation.isPending
              }
            >
              {(createMappingMutation.isPending || updateMappingMutation.isPending) && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {editingMapping ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* LOOKUP TABLE MODAL - ENHANCED FOR CALCULATOR REFERENCE */}
      <Dialog open={isLookupTableModalOpen} onOpenChange={setIsLookupTableModalOpen}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] flex flex-col">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                <Database className="h-6 w-6 text-primary" />
              </div>
              <div>
                <span className="text-xl font-bold">{modalProcessName}</span>
                <span className="text-lg font-normal text-muted-foreground ml-2">Reference Tables</span>
              </div>
            </DialogTitle>
            <DialogDescription className="text-base mt-2">
              Lookup tables and reference data for calculator creation and process planning
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
            {loadingModalTables ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Loading Reference Data</h3>
                  <p className="text-muted-foreground">Fetching lookup tables for {modalProcessName}...</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {/* Saved tables list */}
                {modalReferenceTables && modalReferenceTables.length > 0 ? (
                  modalReferenceTables.map((table) => (
                    <div key={table.id} className="border border-border rounded-lg bg-card overflow-hidden">
                      {/* Table header card */}
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-secondary/30 transition-colors"
                        onClick={() => setExpandedTableId(expandedTableId === table.id ? null : table.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-foreground">{table.tableName}</h3>
                          {table.tableDescription && (
                            <p className="text-sm text-muted-foreground mt-0.5">{table.tableDescription}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-4 shrink-0">
                          <Badge variant="outline" className="text-xs">
                            {table.rows?.length ?? 0} rows
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={(e) => { e.stopPropagation(); setExpandedTableId(expandedTableId === table.id ? null : table.id); }}
                          >
                            {expandedTableId === table.id ? 'Collapse' : 'View / Edit'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="Delete table"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`Delete "${table.tableName}"? This cannot be undone.`)) return;
                              try {
                                const { apiClient } = await import('@/lib/api/client');
                                await apiClient.delete(`/processes/reference-tables/${table.id}`);
                                toast.success(`"${table.tableName}" deleted`);
                                if (expandedTableId === table.id) setExpandedTableId(null);
                                refetchModalTables();
                              } catch (err) {
                                toast.error('Failed to delete table');
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {/* Expanded editable table */}
                      {expandedTableId === table.id && (
                        <div className="border-t border-border bg-background/50 p-4">
                          {renderEditableTable(table)}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="font-medium">No reference tables yet</p>
                    <p className="text-sm mt-1">Click "Add New Table" below to create one</p>
                  </div>
                )}

                {/* Add new table section */}
                {showAddTableEditor ? (
                  <div className="border border-primary/30 rounded-lg mt-4">
                    <InlineReferenceTableEditor
                      processId={modalProcessId || ''}
                      processName={modalProcessName}
                      tables={inlineEditorTables}
                      onTablesChange={setInlineEditorTables}
                      onViewTables={() => setShowAddTableEditor(false)}
                      onSave={async (tables) => {
                        try {
                          const { apiClient } = await import('@/lib/api/client');
                          for (const table of tables) {
                            const tableResponse = await apiClient.post(`/processes/${modalProcessId}/reference-tables`, {
                              processId: modalProcessId,
                              tableName: table.table_name,
                              tableDescription: table.table_description,
                              columnDefinitions: table.column_definitions,
                              isEditable: true,
                              displayOrder: 0
                            });
                            if (table.rows && table.rows.length > 0) {
                              for (let i = 0; i < table.rows.length; i++) {
                                await apiClient.post(`/processes/reference-tables/${tableResponse.id}/rows`, {
                                  tableId: tableResponse.id,
                                  rowData: table.rows[i],
                                  rowOrder: i
                                });
                              }
                            }
                          }
                          toast.success(`Successfully saved ${tables.length} reference tables`);
                          if (modalProcessId) {
                            refetchModalTables();
                            setInlineEditorTables([]);
                            setShowAddTableEditor(false);
                          }
                        } catch (error) {
                          console.error('Failed to save reference tables:', error);
                          toast.error('Failed to save reference tables');
                        }
                      }}
                    />
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="w-full mt-2 border-dashed border-primary/40 text-primary hover:bg-primary/5"
                    onClick={() => { setInlineEditorTables([]); setShowAddTableEditor(true); }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add New Table
                  </Button>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-4 flex justify-between">
            <div className="text-sm text-muted-foreground">
              {modalReferenceTables?.length ? (
                <span>{modalReferenceTables.length} reference table{modalReferenceTables.length !== 1 ? 's' : ''}</span>
              ) : null}
            </div>
            <Button onClick={() => setIsLookupTableModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
}
