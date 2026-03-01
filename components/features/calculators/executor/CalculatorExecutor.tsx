'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, ArrowLeft, Play, AlertCircle, Table2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCalculator, useExecuteCalculator } from '@/lib/api/hooks';

type CalculatorExecutorProps = {
  calculatorId: string;
};

type FieldValues = Record<string, string | number | null>;

// Reference table field names that trigger a lookup table display
const REFERENCE_TABLE_FIELDS = [
  'fromViscosity',
  'fromCavityPressure',
  'fromCavitiesRecommendation',
  'fromRunnerDia',
];

type ReferenceTableData = {
  fieldName: string;
  fieldLabel: string;
  tableName: string;
  tableId: string;
  column_definitions: Array<{ name: string; label: string; unit?: string; type: string }>;
  rows: Array<Record<string, any>>;
};

export function CalculatorExecutor({ calculatorId }: CalculatorExecutorProps) {
  const router = useRouter();
  const { data: calculator, isLoading, error } = useCalculator(calculatorId);
  const executeCalculatorMutation = useExecuteCalculator();

  const [fieldValues, setFieldValues] = useState<FieldValues>({});
  const [results, setResults] = useState<Record<string, any> | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [lookupTables, setLookupTables] = useState<ReferenceTableData[]>([]);
  const [viewingTableFor, setViewingTableFor] = useState<string | null>(null);

  // Initialize field values when calculator loads
  useEffect(() => {
    if (calculator?.fields) {
      const initialValues: FieldValues = {};
      calculator.fields.forEach((field) => {
        // Only set default values for non-calculated fields
        if (field.fieldType !== 'calculated') {
          initialValues[field.fieldName] = field.defaultValue ?? null;
        }
      });
      setFieldValues(initialValues);
      
      // Fetch lookup tables immediately for display
      fetchLookupTables();
    }
  }, [calculator]);

  // Fetch reference tables for database_lookup fields after process
  const fetchLookupTables = async () => {
    if (!calculator?.fields) {
      return;
    }
    
    // If no associatedProcessId, try to fetch tables directly by field IDs
    if (!calculator.associatedProcessId) {
      const directTables: ReferenceTableData[] = [];
      
      for (const field of calculator.fields) {
        if (field.fieldType === 'database_lookup' && 
            field.dataSource === 'processes' && 
            field.sourceField?.startsWith('from_')) {
          const tableId = field.sourceField.replace('from_', '');
          
          try {
            const { processesApi } = await import('@/lib/api/processes');
            const table = await processesApi.getReferenceTable(tableId);
            if (table) {
              const processedRows = table.rows?.map((row) => {
                // Handle different data structures
                if (row.rowData) {
                  return row.rowData;
                }
                // If no rowData property, the row might be the data itself
                return row;
              }) || [];
              
              directTables.push({
                fieldName: field.fieldName,
                fieldLabel: field.displayLabel || field.fieldName,
                tableName: table.tableName,
                tableId: table.id,
                column_definitions: table.columnDefinitions || [],
                rows: processedRows
              });
            }
          } catch (error) {
            console.error('Failed to fetch table directly:', error);
          }
        }
      }
      
      if (directTables.length > 0) {
        setLookupTables(directTables);
        return;
      } else {
        return;
      }
    }

    const refTableFields = calculator.fields.filter(
      (f) =>
        f.fieldType === 'database_lookup' &&
        f.dataSource === 'processes' &&
        f.sourceField &&
        (REFERENCE_TABLE_FIELDS.includes(f.sourceField) || f.sourceField.startsWith('from_'))
    );

    if (refTableFields.length === 0) {
      return;
    }

    try {
      const { apiClient } = await import('@/lib/api/client');

      // Step 1: Resolve associatedProcessId (string slug) to UUID
      const processesResponse = await apiClient.get('/processes');
      const processes = (processesResponse as any).processes || [];

      const matchingProcess = processes.find((p: any) =>
        p.processName?.toLowerCase().replace(/\s+/g, '-') === calculator.associatedProcessId
      );

      if (!matchingProcess) return;

      // Step 2: Fetch reference tables for this process
      const response: any = await apiClient.get(`/processes/${matchingProcess.id}/reference-tables`);
      const allTables: any[] = response.tables || [];

      // Step 3: Match each refTable field to its reference table by name or ID
      const tableFieldNameMap: Record<string, string> = {
        fromViscosity: 'material viscosity',
        fromCavityPressure: 'cavity pressure',
        fromCavitiesRecommendation: 'cavities recommendation',
        fromRunnerDia: 'runner diameter',
      };

      const matched: ReferenceTableData[] = [];

      for (const field of refTableFields) {
        if (!field.sourceField) continue;
        
        let matchedTable;
        
        // Handle dynamic from_ fields by extracting table ID
        if (field.sourceField.startsWith('from_')) {
          const tableId = field.sourceField.replace('from_', '');
          matchedTable = allTables.find((t: any) => t.id === tableId);
        } else {
          // Handle legacy hardcoded field names
          const keyword = tableFieldNameMap[field.sourceField] || '';
          matchedTable = allTables.find((t: any) =>
            t.table_name?.toLowerCase().includes(keyword.toLowerCase())
          );
        }

        if (matchedTable) {
          matched.push({
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: matchedTable.table_name,
            tableId: matchedTable.id,
            column_definitions: matchedTable.column_definitions || [],
            rows: matchedTable.rows || [],
          });
        }
      }

      setLookupTables(matched);
    } catch (err) {
      console.error('Failed to fetch lookup tables:', err);
    }
  };

  const handleExecute = async () => {
    if (!calculator) return;

    // Clear previous errors and lookup tables
    setExecutionError(null);
    setLookupTables([]);

    try {
      const result = await executeCalculatorMutation.mutateAsync({
        calculatorId,
        inputValues: fieldValues,
      });

      if (result.success) {
        setResults(result.results);

        // Fetch lookup tables to display below results
        await fetchLookupTables();

        // Check if any calculations failed
        const hasErrors = Object.values(result.results).some(
          (val: any) => val && typeof val === 'object' && val.error
        );

        if (hasErrors) {
          toast.warning('Calculation completed with some errors. Check individual fields below.');
        } else {
          toast.success(`Calculation completed successfully in ${result.durationMs}ms`);
        }
      } else {
        const errorMsg = result.error || 'Failed to execute calculator';
        setExecutionError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Failed to execute calculator';
      setExecutionError(errorMsg);
      toast.error(errorMsg);
      console.error('Execution error:', err);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <Calculator className="h-12 w-12 animate-spin mx-auto text-primary" />
          <p className="text-muted-foreground font-medium">Loading calculator...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !calculator) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4 max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive" />
          <div>
            <p className="text-lg font-semibold text-destructive mb-2">
              {error ? 'Failed to load calculator' : 'Calculator not found'}
            </p>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : 'The calculator you requested could not be found.'}
            </p>
          </div>
          <Button onClick={() => router.push('/calculators')} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Calculators
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/calculators')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{calculator.name}</h1>
            {calculator.description && (
              <p className="text-muted-foreground mt-1">{calculator.description}</p>
            )}
          </div>
        </div>
        <Button onClick={handleExecute} disabled={executeCalculatorMutation.isPending}>
          <Play className="h-4 w-4 mr-2" />
          {executeCalculatorMutation.isPending ? 'Calculating...' : 'Calculate'}
        </Button>
      </div>

      {/* Execution Error Alert */}
      {executionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Execution Failed</AlertTitle>
          <AlertDescription>{executionError}</AlertDescription>
        </Alert>
      )}

      {/* Input Fields - Only show non-calculated fields */}
      <Card>
        <CardHeader>
          <CardTitle>Input Values</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {calculator.fields
            ?.filter((field) => 
              field.fieldType !== 'calculated'
            )
            .map((field) => (
              <div key={field.id} className="space-y-2">
                <Label htmlFor={field.fieldName}>
                  {field.displayLabel || field.fieldName}
                  {field.isRequired && <span className="text-destructive ml-1">*</span>}
                </Label>
                <div className="relative">
                  <Input
                    id={field.fieldName}
                    type={field.fieldType === 'number' ? 'number' : 'text'}
                    value={fieldValues[field.fieldName]?.toString() || ''}
                    onChange={(e) =>
                      setFieldValues((prev) => ({
                        ...prev,
                        [field.fieldName]: field.fieldType === 'number' ? parseFloat(e.target.value) : e.target.value,
                      }))
                    }
                    placeholder={field.displayLabel}
                    className="bg-primary/5 border-primary/10"
                  />
                  {/* Show eye button for database lookup fields */}
                  {field.fieldType === 'database_lookup' && 
                   field.dataSource === 'processes' && 
                   field.sourceField?.startsWith('from_') && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                      onClick={() => setViewingTableFor(
                        viewingTableFor === field.fieldName ? null : field.fieldName
                      )}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  )}
                </div>
                {field.unit && (
                  <p className="text-xs text-muted-foreground">Unit: {field.unit}</p>
                )}
              </div>
            ))}
        </CardContent>
      </Card>

      {/* Reference Table Viewer */}
      {viewingTableFor && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Table2 className="h-5 w-5" />
                Reference Table for {calculator.fields?.find(f => f.fieldName === viewingTableFor)?.displayLabel || viewingTableFor}
              </CardTitle>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setViewingTableFor(null)}
              >
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const field = calculator.fields?.find(f => f.fieldName === viewingTableFor);
              const table = lookupTables.find(t => t.fieldName === viewingTableFor);
              
              if (!table) {
                return (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">Loading reference table...</p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Click on a row to select the value for {field?.displayLabel || viewingTableFor}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b">
                        {table.column_definitions.map((col) => (
                          <th key={col.name} className="text-left p-3 font-medium">
                            {col.label || col.name}
                            {col.unit && <span className="text-muted-foreground ml-1">({col.unit})</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, index) => (
                        <tr 
                          key={index} 
                          className="border-b hover:bg-primary/10 cursor-pointer transition-colors"
                          onClick={() => {
                            const field = calculator.fields?.find(f => f.fieldName === viewingTableFor);
                            if (field?.sourceField?.startsWith('from_')) {
                              // Extract table ID from sourceField (e.g., "from_viscosity" -> "viscosity")
                              const tableId = field.sourceField.replace('from_', '');
                              
                              // Find the appropriate column value to use
                              // For viscosity table, use the viscosity value
                              // For other tables, try to find a relevant numeric column
                              let valueToSet = null;
                              
                              if (tableId === 'viscosity' && row.viscosity !== undefined) {
                                valueToSet = row.viscosity;
                              } else {
                                // Find first numeric column that isn't 'id'
                                const numericCol = table.column_definitions.find(
                                  col => col.type === 'number' && col.name !== 'id'
                                );
                                if (numericCol) {
                                  valueToSet = row[numericCol.name];
                                }
                              }
                              
                              if (valueToSet !== null) {
                                setFieldValues(prev => ({
                                  ...prev,
                                  [viewingTableFor]: field.fieldType === 'number' ? Number(valueToSet) : valueToSet
                                }));
                                setViewingTableFor(null); // Close the table
                                toast.success(`Selected value: ${valueToSet}`);
                              }
                            }
                          }}
                        >
                          {table.column_definitions.map((col) => (
                            <td key={col.name} className="p-3">
                              {row[col.name] ?? '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Results - Show both calculated fields and formulas */}
      {results && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Show calculated fields */}
              {calculator.fields
                ?.filter((field) => field.fieldType === 'calculated')
                .map((field) => {
                  const value = results[field.id] ?? results[field.fieldName];

                  // Handle error case
                  if (value && typeof value === 'object' && value.error) {
                    return (
                      <div key={field.id} className="flex justify-between items-center py-3 px-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <div className="flex-1">
                          <span className="font-semibold text-base">{field.displayLabel || field.fieldName}</span>
                          {field.defaultValue && (
                            <p className="text-xs text-muted-foreground mt-1 font-mono">
                              {field.defaultValue}
                            </p>
                          )}
                          <p className="text-xs text-destructive mt-1">
                            Error: {value.error}
                          </p>
                        </div>
                        <span className="text-sm text-destructive font-medium">
                          Calculation Failed
                        </span>
                      </div>
                    );
                  }

                  // Don't skip if value is 0 or false, only skip if undefined
                  if (value === undefined || value === null) {
                    return (
                      <div key={field.id} className="flex justify-between items-center py-3 px-4 bg-muted/50 border border-border rounded-lg">
                        <div className="flex-1">
                          <span className="font-semibold text-base">{field.displayLabel || field.fieldName}</span>
                          {field.defaultValue && (
                            <p className="text-xs text-muted-foreground mt-1 font-mono">
                              {field.defaultValue}
                            </p>
                          )}
                        </div>
                        <span className="text-sm text-muted-foreground">
                          Pending
                        </span>
                      </div>
                    );
                  }

                  const displayValue = typeof value === 'object' ? value.value : value;
                  const formattedValue = typeof displayValue === 'number'
                    ? displayValue.toFixed(3)
                    : displayValue?.toString() || 'N/A';

                  return (
                    <div key={field.id} className="flex justify-between items-center py-3 px-4 bg-success/5 border border-success/30 rounded-lg">
                      <div className="flex-1">
                        <span className="font-semibold text-base">{field.displayLabel || field.fieldName}</span>
                        {field.defaultValue && (
                          <p className="text-xs text-muted-foreground mt-1 font-mono">
                            {field.defaultValue}
                          </p>
                        )}
                      </div>
                      <span className="text-2xl font-bold text-success">
                        {formattedValue}
                        {field.unit && <span className="text-sm text-muted-foreground ml-2">{field.unit}</span>}
                      </span>
                    </div>
                  );
                })}

              {/* Show regular formulas if any */}
              {calculator.formulas && calculator.formulas.length > 0 && calculator.formulas
                .filter((formula) => formula.displayInResults !== false)
                .map((formula) => {
                  const value = results[formula.id] ?? results[formula.formulaName];
                  if (value === undefined) return null;

                  const displayValue = typeof value === 'object' ? value.value : value;
                  const formattedValue = typeof displayValue === 'number'
                    ? displayValue.toFixed(formula.decimalPlaces ?? 2)
                    : displayValue;

                  return (
                    <div key={formula.id} className="flex justify-between items-center py-3 px-4 bg-muted/50 rounded-lg">
                      <span className="font-medium text-base">{formula.displayLabel || formula.formulaName}:</span>
                      <span className="text-xl font-bold">
                        {formattedValue}
                        {formula.outputUnit && <span className="text-sm text-muted-foreground ml-2">{formula.outputUnit}</span>}
                      </span>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}


    </div>
  );
}
