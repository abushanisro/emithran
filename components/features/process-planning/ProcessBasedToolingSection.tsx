'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ToolingCostDialog } from './ToolingCostDialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  useToolingCosts,
  useCreateToolingCost,
  useUpdateToolingCost,
  useDeleteToolingCost,
} from '@/lib/api/hooks/useToolingCosts';

interface ProcessBasedToolingSectionProps {
  bomItemId?: string;
  bomItem?: any;
}

// Manufacturing Process Hierarchy
const MANUFACTURING_PROCESSES = {
  machining: {
    label: 'Machining',
    icon: '⚙️',
    subProcesses: {
      turning: {
        label: 'Turning',
        toolTypes: ['cutting_tool', 'fixture', 'measuring_tool', 'special_tool']
      },
      milling: {
        label: 'Milling',
        toolTypes: ['cutting_tool', 'fixture', 'measuring_tool', 'special_tool']
      },
      drilling: {
        label: 'Drilling',
        toolTypes: ['cutting_tool', 'fixture', 'jig']
      },
      grinding: {
        label: 'Grinding',
        toolTypes: ['cutting_tool', 'fixture', 'measuring_tool']
      },
      boring: {
        label: 'Boring',
        toolTypes: ['cutting_tool', 'fixture', 'measuring_tool']
      },
      threading: {
        label: 'Threading',
        toolTypes: ['cutting_tool', 'fixture', 'gauge']
      }
    }
  },
  injection_molding: {
    label: 'Injection Molding',
    icon: '🏭',
    subProcesses: {
      mold_making: {
        label: 'Mold Making',
        toolTypes: ['die', 'cutting_tool', 'measuring_tool']
      },
      injection: {
        label: 'Injection Process',
        toolTypes: ['die', 'fixture', 'test_equipment']
      },
      cooling: {
        label: 'Cooling System',
        toolTypes: ['special_tool', 'measuring_tool']
      },
      ejection: {
        label: 'Ejection System',
        toolTypes: ['special_tool', 'fixture']
      }
    }
  },
  sheet_metal: {
    label: 'Sheet Metal',
    icon: '📋',
    subProcesses: {
      cutting: {
        label: 'Cutting',
        toolTypes: ['cutting_tool', 'fixture', 'measuring_tool']
      },
      bending: {
        label: 'Bending',
        toolTypes: ['die', 'fixture', 'gauge']
      },
      punching: {
        label: 'Punching',
        toolTypes: ['punch', 'die', 'fixture']
      },
      stamping: {
        label: 'Stamping',
        toolTypes: ['die', 'punch', 'fixture']
      },
      welding: {
        label: 'Welding',
        toolTypes: ['fixture', 'jig', 'special_tool']
      },
      forming: {
        label: 'Forming',
        toolTypes: ['die', 'fixture', 'gauge']
      }
    }
  },
  casting: {
    label: 'Casting',
    icon: '🔥',
    subProcesses: {
      sand_casting: {
        label: 'Sand Casting',
        toolTypes: ['die', 'fixture', 'special_tool']
      },
      investment_casting: {
        label: 'Investment Casting',
        toolTypes: ['die', 'fixture', 'measuring_tool']
      },
      die_casting: {
        label: 'Die Casting',
        toolTypes: ['die', 'fixture', 'test_equipment']
      },
      permanent_mold: {
        label: 'Permanent Mold',
        toolTypes: ['die', 'fixture', 'special_tool']
      },
      pattern_making: {
        label: 'Pattern Making',
        toolTypes: ['cutting_tool', 'measuring_tool', 'special_tool']
      }
    }
  },
  forging: {
    label: 'Forging',
    icon: '🔨',
    subProcesses: {
      hot_forging: {
        label: 'Hot Forging',
        toolTypes: ['die', 'fixture', 'special_tool']
      },
      cold_forging: {
        label: 'Cold Forging',
        toolTypes: ['die', 'punch', 'fixture']
      },
      upset_forging: {
        label: 'Upset Forging',
        toolTypes: ['die', 'fixture', 'measuring_tool']
      },
      drop_forging: {
        label: 'Drop Forging',
        toolTypes: ['die', 'fixture', 'special_tool']
      },
      press_forging: {
        label: 'Press Forging',
        toolTypes: ['die', 'fixture', 'measuring_tool']
      }
    }
  },
  assembly: {
    label: 'Assembly',
    icon: '🔧',
    subProcesses: {
      mechanical_assembly: {
        label: 'Mechanical Assembly',
        toolTypes: ['assembly_tool', 'fixture', 'measuring_tool']
      },
      welded_assembly: {
        label: 'Welded Assembly',
        toolTypes: ['fixture', 'jig', 'assembly_tool']
      },
      fastened_assembly: {
        label: 'Fastened Assembly',
        toolTypes: ['assembly_tool', 'fixture', 'gauge']
      },
      bonded_assembly: {
        label: 'Bonded Assembly',
        toolTypes: ['fixture', 'assembly_tool', 'special_tool']
      }
    }
  },
  finishing: {
    label: 'Finishing',
    icon: '✨',
    subProcesses: {
      surface_treatment: {
        label: 'Surface Treatment',
        toolTypes: ['fixture', 'special_tool', 'test_equipment']
      },
      painting: {
        label: 'Painting',
        toolTypes: ['fixture', 'special_tool', 'test_equipment']
      },
      plating: {
        label: 'Plating',
        toolTypes: ['fixture', 'special_tool', 'measuring_tool']
      },
      heat_treatment: {
        label: 'Heat Treatment',
        toolTypes: ['fixture', 'measuring_tool', 'test_equipment']
      }
    }
  },
  inspection: {
    label: 'Quality Control & Inspection',
    icon: '🔍',
    subProcesses: {
      dimensional_inspection: {
        label: 'Dimensional Inspection',
        toolTypes: ['measuring_tool', 'gauge', 'test_equipment']
      },
      functional_testing: {
        label: 'Functional Testing',
        toolTypes: ['test_equipment', 'fixture', 'special_tool']
      },
      visual_inspection: {
        label: 'Visual Inspection',
        toolTypes: ['measuring_tool', 'gauge', 'special_tool']
      },
      material_testing: {
        label: 'Material Testing',
        toolTypes: ['test_equipment', 'special_tool', 'measuring_tool']
      }
    }
  }
};

// Tool type definitions with descriptions
const TOOL_TYPE_DEFINITIONS = {
  cutting_tool: { 
    label: 'Cutting Tools', 
    description: 'End mills, drills, inserts, taps, reamers',
    category: 'machining'
  },
  fixture: { 
    label: 'Fixtures & Work Holding', 
    description: 'Clamps, chucks, vises, work holding devices',
    category: 'setup'
  },
  jig: { 
    label: 'Jigs & Templates', 
    description: 'Drilling jigs, assembly jigs, templates',
    category: 'setup'
  },
  die: { 
    label: 'Dies & Molds', 
    description: 'Injection molds, stamping dies, forging dies',
    category: 'forming'
  },
  punch: { 
    label: 'Punches & Stamps', 
    description: 'Punch sets, stamping tools, piercing tools',
    category: 'forming'
  },
  gauge: { 
    label: 'Go/No-Go Gauges', 
    description: 'Pin gauges, thread gauges, profile gauges',
    category: 'inspection'
  },
  measuring_tool: { 
    label: 'Measuring Tools', 
    description: 'Calipers, micrometers, height gauges, CMM fixtures',
    category: 'inspection'
  },
  special_tool: { 
    label: 'Special Purpose Tools', 
    description: 'Custom tools, specialized equipment',
    category: 'custom'
  },
  assembly_tool: { 
    label: 'Assembly Tools', 
    description: 'Torque wrenches, assembly fixtures, presses',
    category: 'assembly'
  },
  test_equipment: { 
    label: 'Test Equipment', 
    description: 'Pressure testers, leak testers, functional test rigs',
    category: 'inspection'
  }
};

export function ProcessBasedToolingSection({ bomItemId, bomItem }: ProcessBasedToolingSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTooling, setEditTooling] = useState<any | null>(null);
  const [selectedProcess, setSelectedProcess] = useState<string | null>(null);
  const [selectedSubProcess, setSelectedSubProcess] = useState<string | null>(null);
  const [openProcesses, setOpenProcesses] = useState<Set<string>>(new Set());

  if (!bomItemId) {
    return (
      <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
        <div className="bg-primary py-3 px-4">
          <h6 className="m-0 font-semibold text-primary-foreground">Process-Based Tooling & Fixtures</h6>
        </div>
        <div className="bg-card p-8 text-center text-muted-foreground">
          <p className="text-sm">Please select a BOM item to manage process-based tooling</p>
        </div>
      </div>
    );
  }

  // Fetch tooling costs from database
  const { data, isLoading, error } = useToolingCosts({
    bomItemId,
    enabled: !!bomItemId,
  });

  // Mutations
  const createMutation = useCreateToolingCost();
  const updateMutation = useUpdateToolingCost();
  const deleteMutation = useDeleteToolingCost();

  const tooling = data?.records || [];

  const toggleProcess = (processKey: string) => {
    const newOpenProcesses = new Set(openProcesses);
    if (newOpenProcesses.has(processKey)) {
      newOpenProcesses.delete(processKey);
    } else {
      newOpenProcesses.add(processKey);
    }
    setOpenProcesses(newOpenProcesses);
  };

  const handleAddTooling = (processKey?: string, subProcessKey?: string) => {
    setEditTooling(null);
    setSelectedProcess(processKey || null);
    setSelectedSubProcess(subProcessKey || null);
    setDialogOpen(true);
  };

  const handleEditTooling = (toolingItem: any) => {
    setEditTooling(toolingItem);
    setSelectedProcess(null);
    setSelectedSubProcess(null);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (data: any) => {
    if (!bomItemId) return;

    try {
      const submitData = {
        ...data,
        manufacturingProcess: selectedProcess || data.manufacturingProcess,
        subProcess: selectedSubProcess || data.subProcess,
      };

      if (editTooling?.id) {
        await updateMutation.mutateAsync({
          id: editTooling.id,
          data: submitData,
        });
      } else {
        await createMutation.mutateAsync({
          bomItemId,
          ...submitData,
        });
      }
      setDialogOpen(false);
    } catch (error) {
      // Error is handled by the mutations
    }
  };

  const handleDeleteTooling = async (toolingId: string) => {
    if (!bomItemId) return;
    
    if (confirm('Are you sure you want to delete this tooling item?')) {
      try {
        await deleteMutation.mutateAsync({ id: toolingId, bomItemId });
      } catch (error) {
        // Error is handled by the mutation
      }
    }
  };

  // Group tooling by process and sub-process
  const groupedTooling = tooling.reduce((groups: any, item: any) => {
    const process = item.manufacturingProcess || 'unassigned';
    const subProcess = item.subProcess || 'unassigned';
    
    if (!groups[process]) {
      groups[process] = {};
    }
    if (!groups[process][subProcess]) {
      groups[process][subProcess] = [];
    }
    groups[process][subProcess].push(item);
    
    return groups;
  }, {});

  const calculateProcessTotal = (processKey: string) => {
    const processTooling = groupedTooling[processKey] || {};
    return Object.values(processTooling).flat().reduce((sum: number, item: any) => sum + (item.totalCost || 0), 0);
  };

  const calculateSubProcessTotal = (processKey: string, subProcessKey: string) => {
    const subProcessTooling = groupedTooling[processKey]?.[subProcessKey] || [];
    return subProcessTooling.reduce((sum: number, item: any) => sum + (item.totalCost || 0), 0);
  };

  const calculateGrandTotal = () => {
    return tooling.reduce((sum, item) => sum + (item.totalCost || 0), 0);
  };

  return (
    <div className="card border-l-4 border-l-primary shadow-md mb-4 mt-3 rounded-lg overflow-hidden">
      <div className="bg-primary py-3 px-4">
        <div className="flex items-center justify-between">
          <h6 className="m-0 font-semibold text-primary-foreground">Process-Based Tooling & Fixtures</h6>
          <Badge variant="secondary" className="bg-primary-foreground/20 text-primary-foreground">
            Total: ₹{calculateGrandTotal().toFixed(2)}
          </Badge>
        </div>
      </div>
      <div className="bg-card p-4">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Loading tooling...</span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-destructive">
            <p className="text-sm">Error loading tooling data. Please try again.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Manufacturing Processes */}
            {Object.entries(MANUFACTURING_PROCESSES).map(([processKey, process]) => (
              <Collapsible 
                key={processKey} 
                open={openProcesses.has(processKey)}
                onOpenChange={() => toggleProcess(processKey)}
              >
                <div className="border border-border rounded-lg overflow-hidden">
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between p-3 bg-secondary/50 hover:bg-secondary/70 cursor-pointer transition-colors">
                      <div className="flex items-center gap-3">
                        {openProcesses.has(processKey) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <span className="text-lg">{process.icon}</span>
                        <h3 className="font-semibold text-sm">{process.label}</h3>
                        <Badge variant="outline" className="text-xs">
                          {Object.keys(groupedTooling[processKey] || {}).length} sub-processes
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          ₹{calculateProcessTotal(processKey).toFixed(2)}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAddTooling(processKey);
                          }}
                          title={`Add tooling for ${process.label}`}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  
                  <CollapsibleContent>
                    <div className="p-4 space-y-3">
                      {/* Sub-processes */}
                      {Object.entries(process.subProcesses).map(([subProcessKey, subProcess]) => {
                        const subProcessTooling = groupedTooling[processKey]?.[subProcessKey] || [];
                        const subProcessTotal = calculateSubProcessTotal(processKey, subProcessKey);
                        
                        return (
                          <div key={subProcessKey} className="border border-border/50 rounded-md">
                            <div className="flex items-center justify-between p-3 bg-muted/30">
                              <div className="flex items-center gap-3">
                                <h4 className="font-medium text-sm">{subProcess.label}</h4>
                                <Badge variant="outline" className="text-xs">
                                  {subProcessTooling.length} tools
                                </Badge>
                                {subProcessTotal > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    ₹{subProcessTotal.toFixed(2)}
                                  </Badge>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => handleAddTooling(processKey, subProcessKey)}
                                title={`Add tooling for ${subProcess.label}`}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            
                            {/* Tooling items for this sub-process */}
                            {subProcessTooling.length > 0 && (
                              <div className="p-3">
                                <div className="space-y-2">
                                  {subProcessTooling.map((item: any) => (
                                    <div key={item.id} className="flex items-center justify-between p-2 bg-background rounded border border-border/30">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium text-sm">
                                            {TOOL_TYPE_DEFINITIONS[item.toolingType as keyof typeof TOOL_TYPE_DEFINITIONS]?.label || item.toolingType?.replace('_', ' ') || 'Tooling'}
                                          </span>
                                          {item.isCustom && (
                                            <Badge variant="secondary" className="text-xs">Custom</Badge>
                                          )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">{item.description}</p>
                                        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                                          <span>Qty: {item.quantity}</span>
                                          <span>Cost: ₹{item.unitCost.toFixed(2)}</span>
                                          <span>Usage: {item.usagePercentage}%</span>
                                          <span className="font-medium">Total: ₹{item.totalCost.toFixed(2)}</span>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0"
                                          onClick={() => handleEditTooling(item)}
                                          title="Edit"
                                        >
                                          <Edit className="h-3 w-3" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                          onClick={() => handleDeleteTooling(item.id)}
                                          title="Delete"
                                          disabled={deleteMutation.isPending}
                                        >
                                          {deleteMutation.isPending ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <Trash2 className="h-3 w-3" />
                                          )}
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Recommended tool types for this sub-process */}
                            <div className="p-3 border-t border-border/30 bg-muted/10">
                              <p className="text-xs text-muted-foreground mb-2">Recommended tool types:</p>
                              <div className="flex flex-wrap gap-1">
                                {subProcess.toolTypes.map((toolType) => (
                                  <Badge key={toolType} variant="outline" className="text-xs">
                                    {TOOL_TYPE_DEFINITIONS[toolType as keyof typeof TOOL_TYPE_DEFINITIONS]?.label || toolType}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Unassigned tools in this process */}
                      {groupedTooling[processKey]?.unassigned && (
                        <div className="border border-border/50 rounded-md">
                          <div className="p-3 bg-muted/20">
                            <h4 className="font-medium text-sm text-muted-foreground">Unassigned to Sub-process</h4>
                            <div className="mt-2 space-y-2">
                              {groupedTooling[processKey].unassigned.map((item: any) => (
                                <div key={item.id} className="flex items-center justify-between p-2 bg-background rounded border border-border/30">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-sm">
                                        {TOOL_TYPE_DEFINITIONS[item.toolingType as keyof typeof TOOL_TYPE_DEFINITIONS]?.label || item.toolingType?.replace('_', ' ') || 'Tooling'}
                                      </span>
                                      {item.isCustom && (
                                        <Badge variant="secondary" className="text-xs">Custom</Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">{item.description}</p>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => handleEditTooling(item)}
                                      title="Edit"
                                    >
                                      <Edit className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                                      onClick={() => handleDeleteTooling(item.id)}
                                      title="Delete"
                                      disabled={deleteMutation.isPending}
                                    >
                                      {deleteMutation.isPending ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
            
            {/* Unassigned tools (no process specified) */}
            {groupedTooling.unassigned && (
              <div className="border border-border rounded-lg">
                <div className="p-3 bg-muted/20">
                  <h3 className="font-semibold text-sm text-muted-foreground">Unassigned Tools</h3>
                  <div className="mt-2 space-y-2">
                    {Object.values(groupedTooling.unassigned).flat().map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between p-2 bg-background rounded border border-border/30">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {TOOL_TYPE_DEFINITIONS[item.toolingType as keyof typeof TOOL_TYPE_DEFINITIONS]?.label || item.toolingType?.replace('_', ' ') || 'Tooling'}
                            </span>
                            {item.isCustom && (
                              <Badge variant="secondary" className="text-xs">Custom</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={() => handleEditTooling(item)}
                            title="Edit"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => handleDeleteTooling(item.id)}
                            title="Delete"
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Quick Add Section */}
            <div className="border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => handleAddTooling()}
                  variant="outline"
                  size="sm"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3 mr-1" />
                      Add General Tooling
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Tooling Dialog */}
      <ToolingCostDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleDialogSubmit}
        initialData={editTooling}
        bomItem={bomItem}
        selectedProcess={selectedProcess}
        selectedSubProcess={selectedSubProcess}
        processHierarchy={MANUFACTURING_PROCESSES}
        toolTypeDefinitions={TOOL_TYPE_DEFINITIONS}
      />
    </div>
  );
}