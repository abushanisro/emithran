'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Eye, Plus, Trash2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  useCalculator,
  useUpdateCalculator,
  useCreateField,
  useUpdateField,
  useDeleteField
} from '@/lib/api/hooks';
import type { Calculator, CalculatorField, FieldType, DataSource } from '@/lib/api/calculators';
import { processesApi, type Process } from '@/lib/api/processes';
import { FormulaEditor } from './FormulaEditor';
import { DatabaseFieldExtractor } from './DatabaseFieldExtractor';
import { cn } from '@/lib/utils';

type CalculatorBuilderProps = {
  calculatorId: string;
};

/**
 * CalculatorBuilder - Enterprise Grade V2
 *
 * PRINCIPLES:
 * 1. Single source of truth (calculator object contains everything)
 * 2. Atomic saves (one Save button saves everything)
 * 3. Strict types (no any, no optional chaining abuse)
 * 4. Explicit state handling (loading, error, empty states)
 */
export function CalculatorBuilder({ calculatorId }: CalculatorBuilderProps) {
  const router = useRouter();

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const { data: calculator, isLoading, error } = useCalculator(calculatorId);
  const updateCalculator = useUpdateCalculator();
  const createField = useCreateField();
  const updateField = useUpdateField();
  const deleteField = useDeleteField();

  // ============================================================================
  // LOCAL STATE (Transient Edit State - NOT Persisted Until Save)
  // ============================================================================

  // This is the ONLY state - one unified object
  const [draftCalculator, setDraftCalculator] = useState<Calculator | null>(null);

  // Process data
  const [processes, setProcesses] = useState<Process[]>([]);
  const [processesLoading, setProcessesLoading] = useState(false);

  // Track which field is being saved or deleted
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [deletingFieldId, setDeletingFieldId] = useState<string | null>(null);

  // Track which fields are saved (not in edit mode)
  const [savedFieldIds, setSavedFieldIds] = useState<Set<string>>(new Set());

  // Track which fields are in edit mode
  const [editingFieldIds, setEditingFieldIds] = useState<Set<string>>(new Set());

  // Determine which data to use (draft or fetched)
  const currentData = draftCalculator || calculator;

  // Initialize saved fields when calculator loads (only on first load)
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    if (calculator?.fields && isInitialLoad) {
      const existingFieldIds = calculator.fields
        .map(f => f.id)
        .filter(id => !id.startsWith('temp-')); // Only mark persisted fields as saved
      setSavedFieldIds(new Set(existingFieldIds));
      setIsInitialLoad(false);
    }
  }, [calculator, isInitialLoad]);

  // Fetch processes on component mount
  useEffect(() => {
    const fetchProcesses = async () => {
      setProcessesLoading(true);
      try {
        const response = await processesApi.getAll();
        setProcesses(response.processes);
      } catch (error) {
        console.error('Failed to fetch processes:', error);
      } finally {
        setProcessesLoading(false);
      }
    };

    fetchProcesses();
  }, []);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleMetadataChange = <K extends keyof Calculator>(key: K, value: Calculator[K]) => {
    if (!currentData) return;

    setDraftCalculator({
      ...currentData,
      [key]: value,
    });
  };

  const handleAddField = () => {
    if (!currentData) return;

    const fieldCount = currentData.fields?.length || 0;
    const newFieldId = `temp-${Date.now()}`;

    const newField: Partial<CalculatorField> = {
      id: newFieldId, // Temporary ID, will be replaced by backend
      fieldName: '', // Will be generated from displayLabel
      displayLabel: '',
      fieldType: 'number',
      isRequired: false,
      displayOrder: fieldCount,
      unit: '',
      defaultValue: '',
      sourceField: '',
      lookupConfig: {},
      inputConfig: { decimalPlaces: 2 },
    };

    setDraftCalculator({
      ...currentData,
      fields: [...(currentData.fields || []), newField as CalculatorField],
    });

    // New fields start in edit mode
    setEditingFieldIds(prev => new Set(prev).add(newFieldId));
  };

  const handleUpdateField = (index: number, updates: Partial<CalculatorField>) => {
    const fields = currentData?.fields;
    const field = fields?.[index];
    if (!field || !fields) return;

    // Set field name from display label, but don't trim the displayLabel during editing
    if (updates.displayLabel !== undefined) {
      updates.fieldName = updates.displayLabel.trim();
      // Don't trim displayLabel here - allow spaces during editing
    }

    const updatedFields = [...fields];
    const fieldId = field.id;
    updatedFields[index] = { ...field, ...updates } as CalculatorField;

    setDraftCalculator({
      ...currentData,
      fields: updatedFields,
    });

    // Mark field as being edited (remove from saved state)
    if (savedFieldIds.has(fieldId)) {
      setEditingFieldIds(prev => new Set(prev).add(fieldId));
      setSavedFieldIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(fieldId);
        return newSet;
      });
    }
  };

  const handleDeleteField = async (index: number) => {
    const fields = currentData?.fields;
    const field = fields?.[index];
    if (!field || !fields) return;

    const fieldId = field.id;
    if (deletingFieldId === fieldId) return;

    setDeletingFieldId(fieldId);

    // Persist delete to server if it's not a temp field
    if (!fieldId.startsWith('temp-')) {
      try {
        await deleteField.mutateAsync({ calculatorId, fieldId });
      } catch (err) {
        console.error('Delete failed:', err);
        setDeletingFieldId(null);
        return; // Stop if delete failed
      }
    }

    setDraftCalculator({
      ...currentData,
      fields: fields.filter((_, i) => i !== index),
    });

    // Clean up tracking sets
    setSavedFieldIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(fieldId);
      return newSet;
    });
    setEditingFieldIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(fieldId);
      return newSet;
    });
    setDeletingFieldId(null);
  };

  const handleCreateBOMFields = (replaceIndex: number) => {
    if (!currentData) return;

    const currentFields = currentData.fields || [];
    const fieldCount = currentFields.length;
    
    // Remove the original field that was changed to BOM
    const fieldsWithoutOriginal = currentFields.filter((_, i) => i !== replaceIndex);
    
    // Define BOM fields to create
    const bomFields = [
      {
        displayLabel: 'Height',
        fieldType: 'number' as FieldType,
        unit: 'mm',
        defaultValue: '',
        displayOrder: replaceIndex
      },
      {
        displayLabel: 'Width',
        fieldType: 'number' as FieldType,
        unit: 'mm',
        defaultValue: '',
        displayOrder: replaceIndex + 1
      },
      {
        displayLabel: 'Length',
        fieldType: 'number' as FieldType,
        unit: 'mm',
        defaultValue: '',
        displayOrder: replaceIndex + 2
      },
      {
        displayLabel: 'Volume',
        fieldType: 'calculated' as FieldType,
        unit: 'mm³',
        defaultValue: 'Height * Width * Length',
        displayOrder: replaceIndex + 3
      },
      {
        displayLabel: 'Principal Property',
        fieldType: 'text' as FieldType,
        unit: '',
        defaultValue: '',
        displayOrder: replaceIndex + 4
      }
    ];

    // Create the new fields with temporary IDs
    const newFields = bomFields.map((bomField, idx) => {
      const newFieldId = `temp-bom-${Date.now()}-${idx}`;
      return {
        id: newFieldId,
        fieldName: bomField.displayLabel,
        displayLabel: bomField.displayLabel,
        fieldType: bomField.fieldType,
        isRequired: false,
        displayOrder: bomField.displayOrder,
        unit: bomField.unit,
        defaultValue: bomField.defaultValue,
        sourceField: '',
        lookupConfig: {},
        inputConfig: { decimalPlaces: 2 },
      } as CalculatorField;
    });

    // Insert new fields at the original position
    const updatedFields = [
      ...fieldsWithoutOriginal.slice(0, replaceIndex),
      ...newFields,
      ...fieldsWithoutOriginal.slice(replaceIndex).map(field => ({
        ...field,
        displayOrder: field.displayOrder + newFields.length - 1
      }))
    ];

    setDraftCalculator({
      ...currentData,
      fields: updatedFields,
    });

    // Mark all new BOM fields as being in edit mode
    const newFieldIds = newFields.map(f => f.id);
    setEditingFieldIds(prev => {
      const newSet = new Set(prev);
      newFieldIds.forEach(id => newSet.add(id));
      return newSet;
    });
  };

  // Formula management removed as it's now integrated into fields
  // handleAddFormula, handleUpdateFormula, handleDeleteFormula were unused

  /**
   * SAVE INDIVIDUAL FIELD
   * Saves a single field immediately
   */
  const handleSaveField = async (fieldId: string) => {
    if (!currentData || !currentData.fields) return;

    const fieldIndex = currentData.fields.findIndex(f => f.id === fieldId);
    if (fieldIndex === -1) return;
    const field = currentData.fields[fieldIndex];
    if (!field) return;

    setSavingFieldId(fieldId);

    try {
      const fieldData = {
        fieldName: (field.fieldName || field.displayLabel || '').trim(),
        displayLabel: (field.displayLabel || '').trim(),
        fieldType: field.fieldType,
        dataSource: field.dataSource,
        sourceTable: field.sourceTable,
        sourceField: field.sourceField,
        lookupConfig: field.lookupConfig,
        defaultValue: field.defaultValue,
        unit: field.unit,
        minValue: field.minValue,
        maxValue: field.maxValue,
        isRequired: field.isRequired,
        validationRules: field.validationRules,
        inputConfig: field.inputConfig,
        displayOrder: field.displayOrder,
        fieldGroup: field.fieldGroup,
      };

      let savedField;
      if (fieldId.startsWith('temp-')) {
        savedField = await createField.mutateAsync({
          calculatorId,
          ...fieldData
        });
      } else {
        savedField = await updateField.mutateAsync({
          calculatorId,
          fieldId,
          data: fieldData
        });
      }

      // Update ONLY this specific field in the local draft to preserve other unsaved changes
      setDraftCalculator(prev => {
        if (!prev || !prev.fields) return prev;
        const updatedFields = [...prev.fields];
        updatedFields[fieldIndex] = savedField;
        return { ...prev, fields: updatedFields };
      });

      // Mark this specific field as saved
      setSavedFieldIds(prev => new Set(prev).add(savedField.id));
      setEditingFieldIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(fieldId);
        newSet.delete(savedField.id);
        return newSet;
      });

    } catch (err) {
      console.error('Field save failed:', err);
    } finally {
      setSavingFieldId(null);
    }
  };

  /**
   * Enable editing mode for a field
   */
  const handleEditField = (fieldId: string) => {
    setEditingFieldIds(prev => new Set(prev).add(fieldId));
    setSavedFieldIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(fieldId);
      return newSet;
    });
  };

  /**
   * ATOMIC SAVE
   * Saves calculator + fields + formulas in ONE request
   */
  const handleSave = async () => {
    if (!currentData) return;

    try {
      const savedCalculator = await updateCalculator.mutateAsync({
        id: calculatorId,
        data: {
          name: currentData.name,
          description: currentData.description,
          calcCategory: currentData.calcCategory || undefined,
          calculatorType: currentData.calculatorType,
          isTemplate: currentData.isTemplate,
          isPublic: currentData.isPublic,
          displayConfig: currentData.displayConfig,
          // ATOMIC: All fields and formulas in one payload
          fields: currentData.fields?.map(f => ({
            fieldName: (f.fieldName || f.displayLabel || '').trim(),
            displayLabel: (f.displayLabel || '').trim(),
            fieldType: f.fieldType,
            dataSource: f.dataSource,
            sourceTable: f.sourceTable,
            sourceField: f.sourceField,
            lookupConfig: f.lookupConfig,
            defaultValue: f.defaultValue,
            unit: f.unit,
            minValue: f.minValue,
            maxValue: f.maxValue,
            isRequired: f.isRequired,
            validationRules: f.validationRules,
            inputConfig: f.inputConfig,
            displayOrder: f.displayOrder,
            fieldGroup: f.fieldGroup,
          })),
          formulas: currentData.formulas?.map(f => ({
            formulaName: f.formulaName || f.displayLabel || '',
            displayLabel: f.displayLabel || '',
            description: f.description,
            formulaType: f.formulaType || 'expression',
            formulaExpression: f.formulaExpression || '',
            visualFormula: f.visualFormula,
            dependsOnFields: f.dependsOnFields,
            dependsOnFormulas: f.dependsOnFormulas,
            outputUnit: f.outputUnit,
            decimalPlaces: f.decimalPlaces,
            displayFormat: f.displayFormat,
            executionOrder: f.executionOrder,
            displayInResults: f.displayInResults,
            isPrimaryResult: f.isPrimaryResult,
            resultGroup: f.resultGroup,
          })),
        },
      });

      // Clear draft state after successful save
      setDraftCalculator(null);

      // Mark all fields as saved
      if (savedCalculator?.fields) {
        const allFieldIds = savedCalculator.fields.map((f: any) => f.id);
        setSavedFieldIds(new Set(allFieldIds));
        setEditingFieldIds(new Set());
      }

      // Navigate back to calculators list
      router.push('/calculators');
    } catch (err) {
      console.error('Save failed:', err);
      // Error toast is handled by the mutation hook
    }
  };

  // ============================================================================
  // RENDER STATES (Explicit Handling)
  // ============================================================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <div className="h-12 w-12 animate-spin mx-auto border-4 border-primary border-t-transparent rounded-full" />
          <p className="text-muted-foreground">Loading calculator...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4">
          <p className="text-lg font-medium text-destructive">Failed to load calculator</p>
          <Button onClick={() => router.push('/calculators')} variant="outline">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Calculators
          </Button>
        </div>
      </div>
    );
  }

  // DEFENSIVE: This should never happen due to React Query, but TypeScript safety
  if (!currentData) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Calculator not found</p>
      </div>
    );
  }

  // ============================================================================
  // MAIN RENDER
  // ============================================================================

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.push('/calculators')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{currentData.name}</h1>
          <p className="text-muted-foreground mt-1">Configure calculator settings</p>
        </div>
      </div>

      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Configure calculator name and settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Calculator Name *</Label>
                <Input
                  id="name"
                  value={currentData.name}
                  onChange={(e) => handleMetadataChange('name', e.target.value)}
                  className="bg-primary/5 border-primary/10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={currentData.calcCategory || ''}
                  onValueChange={(value) => handleMetadataChange('calcCategory', value)}
                >
                  <SelectTrigger id="category" className="bg-primary/5 border-primary/10">
                    <SelectValue placeholder="Select category..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="costing">Costing</SelectItem>
                    <SelectItem value="material">Material</SelectItem>
                    <SelectItem value="process">Process</SelectItem>
                    <SelectItem value="tooling">Tooling</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="process">Associated Process</Label>
                <Select
                  value={currentData.associatedProcessId || ''}
                  onValueChange={(value) => handleMetadataChange('associatedProcessId', value)}
                >
                  <SelectTrigger id="process" className="bg-primary/5 border-primary/10">
                    <SelectValue placeholder="Select process..." />
                  </SelectTrigger>
                  <SelectContent>
                    {processesLoading ? (
                      <div className="text-sm text-muted-foreground px-2 py-1">Loading processes...</div>
                    ) : processes.length === 0 ? (
                      <div className="text-sm text-muted-foreground px-2 py-1">No processes available</div>
                    ) : (
                      processes.map((process) => (
                        <SelectItem key={process.id} value={process.id}>
                          {process.processName}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={currentData.description || ''}
                onChange={(e) => handleMetadataChange('description', e.target.value)}
                placeholder="Enter a brief description of what this calculator does..."
                className="bg-primary/5 border-primary/10"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="isTemplate"
                checked={currentData.isTemplate}
                onCheckedChange={(checked) => handleMetadataChange('isTemplate', checked)}
              />
              <Label htmlFor="isTemplate">Save as template</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fields */}
      <Card>
        <CardHeader>
          <CardTitle>Fields</CardTitle>
          <CardDescription>Input fields for the calculator</CardDescription>
        </CardHeader>
        <CardContent>
          {currentData.fields && currentData.fields.length > 0 ? (
            <div className="space-y-3">
              {currentData.fields.map((field, index) => {
                const isFieldSaved = savedFieldIds.has(field.id) && !editingFieldIds.has(field.id);
                const isFieldEditing = editingFieldIds.has(field.id) || !savedFieldIds.has(field.id);

                return (
                  <div
                    key={field.id || index}
                    className={cn(
                      "p-4 border rounded-lg space-y-3 transition-all",
                      isFieldSaved && "bg-success/5 border-success/20",
                      isFieldEditing && "bg-primary/5 border-primary/20"
                    )}
                  >
                    {/* Status Badge */}
                    <div className="flex items-center justify-end mb-2 h-6">
                      {field.fieldName && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {field.fieldName}
                        </span>
                      )}
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="flex-1 space-y-3">
                        <div className="grid grid-cols-3 gap-3">
                          <Input
                            placeholder="Display Label "
                            value={field.displayLabel || ''}
                            onChange={(e) => handleUpdateField(index, { displayLabel: e.target.value })}
                            disabled={isFieldSaved}
                            className={cn(isFieldSaved ? "bg-secondary/20" : "bg-primary/5 border-primary/10 pr-4")}
                          />
                          <Select
                            value={field.fieldType}
                            disabled={isFieldSaved}
                            onValueChange={(value: FieldType) => {
                              // Handle BOM selection - create multiple fields automatically
                              if (value === 'bom') {
                                handleCreateBOMFields(index);
                                return;
                              }
                              
                              // Clear type-specific fields when switching types
                              if (value !== 'database_lookup') {
                                handleUpdateField(index, {
                                  fieldType: value,
                                  dataSource: undefined,
                                  sourceTable: undefined,
                                  sourceField: undefined,
                                  lookupConfig: {}
                                });
                              } else {
                                handleUpdateField(index, {
                                  fieldType: value,
                                  dataSource: 'raw_materials', // Set default data source
                                  lookupConfig: {}
                                });
                              }
                            }}
                          >
                            <SelectTrigger className={cn(isFieldSaved ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="number">Number</SelectItem>
                              <SelectItem value="text">User Input</SelectItem>
                              <SelectItem value="database_lookup">Database</SelectItem>
                              <SelectItem value="calculated">Custom Formula</SelectItem>
                              <SelectItem value="bom">BOM (Bill of Materials)</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            placeholder="Unit (optional)"
                            value={field.unit || ''}
                            onChange={(e) => handleUpdateField(index, { unit: e.target.value })}
                            disabled={isFieldSaved}
                            className={cn(isFieldSaved ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}
                          />
                        </div>

                        {/* Constant Number Input for Number type */}
                        {field.fieldType === 'number' && (
                          <div className="space-y-2">
                            <Label className="text-xs">Default/Constant Value (Optional)</Label>
                            <Input
                              type="number"
                              placeholder="e.g., 3.14159 for Pi"
                              value={field.defaultValue || ''}
                              onChange={(e) => handleUpdateField(index, { defaultValue: e.target.value })}
                              className={cn("font-mono", isFieldSaved ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}
                              disabled={isFieldSaved}
                            />
                          </div>
                        )}

                        {/* User Input for Text type */}
                        {field.fieldType === 'text' && (
                          <div className="space-y-2 p-3 bg-secondary/20 border border-primary/10 rounded-md">
                            <Label className="text-xs font-semibold">User Input</Label>
                            <p className="text-[10px] text-muted-foreground">
                              This field will accept user input during process planning calculations
                            </p>
                          </div>
                        )}

                      </div>
                      <div className="flex gap-2">
                        {isFieldEditing ? (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleSaveField(field.id)}
                            disabled={savingFieldId === field.id || deletingFieldId === field.id || !field.displayLabel}
                            title="Save this field"
                            className="gap-2"
                          >
                            {savingFieldId === field.id ? (
                              <>
                                <span className="h-4 w-4 animate-spin">⏳</span>
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="h-4 w-4" />
                                Save
                              </>
                            )}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditField(field.id)}
                            title="Edit this field"
                            className="gap-2"
                          >
                            <Pencil className="h-4 w-4" />
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteField(index)}
                          className="text-destructive gap-2"
                          disabled={savingFieldId === field.id || deletingFieldId === field.id}
                        >
                          {deletingFieldId === field.id ? (
                            <>
                              <span className="h-4 w-4 animate-spin">⏳</span>
                              Deleting...
                            </>
                          ) : (
                            <>
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Database Lookup Configuration */}
                    {
                      field.fieldType === 'database_lookup' && (
                        <div className="pl-4 border-l-2 border-primary/20 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label className="text-xs">Data Source *</Label>
                              <Select
                                value={field.dataSource || 'raw_materials'}
                                disabled={isFieldSaved}
                                onValueChange={(value: DataSource) => {
                                  // Clear selected record when changing data source
                                  handleUpdateField(index, {
                                    dataSource: value,
                                    lookupConfig: {}
                                  });
                                }}
                              >
                                <SelectTrigger className={cn(isFieldSaved ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}>
                                  <SelectValue placeholder="Select data source..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="raw_materials">Raw Materials</SelectItem>
                                  <SelectItem value="mhr">Machine Hour Rate (MHR)</SelectItem>
                                  <SelectItem value="lhr">Labor Hour Rate (LHR)</SelectItem>
                                  <SelectItem value="processes">Processes</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {field.dataSource && field.dataSource !== 'manual' && (
                            <DatabaseFieldExtractor
                              dataSource={field.dataSource as DataSource}
                              selectedField={field.sourceField}
                              lookupConfig={field.lookupConfig || {}}
                              associatedProcessId={currentData.associatedProcessId}
                              onFieldSelect={(selectedField) => {
                                handleUpdateField(index, {
                                  sourceField: selectedField,
                                  lookupConfig: {} // reset lookupConfig when field changes
                                });
                              }}
                              onLookupConfigChange={(config) => {
                                handleUpdateField(index, { lookupConfig: config });
                              }}
                              disabled={isFieldSaved}
                            />
                          )}
                        </div>
                      )
                    }

                    {/* Custom Formula Configuration */}
                    {
                      field.fieldType === 'calculated' && (
                        <div className="pl-4 border-l-2 border-primary/20 space-y-3">
                          <FormulaEditor
                            value={field.defaultValue || ''}
                            onChange={(value) => handleUpdateField(index, { defaultValue: value })}
                            availableFields={
                              (currentData.fields || [])
                                .filter((f, i) => {
                                  // Exclude the current field itself
                                  if (i === index) return false;
                                  // Only include calculated fields that come BEFORE this one (prevent circular deps)
                                  if (f.fieldType === 'calculated' && i >= index) return false;
                                  // Must have a label or field name
                                  return f.displayLabel || f.fieldName;
                                })
                                .map((f) => ({
                                  id: f.id,
                                  name: f.fieldName || f.displayLabel || '',
                                  type: f.fieldType,
                                  label: f.displayLabel || f.fieldName || '',
                                }))
                            }
                            disabled={isFieldSaved}
                          />
                        </div>
                      )
                    }
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No fields yet. Add one to get started.</p>
          )}

          {/* Add Field Button - Always at bottom */}
          <div className="mt-4 pt-4 border-t">
            <Button onClick={handleAddField} variant="outline" size="sm" className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Add Field
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex justify-end gap-2 sticky bottom-0 bg-background py-4 border-t">
        <Button variant="outline" onClick={() => router.push(`/calculators/${calculatorId}`)}>
          <Eye className="h-4 w-4 mr-2" />
          Preview
        </Button>
        <Button onClick={handleSave} disabled={updateCalculator.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {updateCalculator.isPending ? 'Saving...' : 'Save All Changes'}
        </Button>
      </div>
    </div>
  );
}
