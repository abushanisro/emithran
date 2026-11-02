'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle, 
  Clock,
  PlayCircle,
  Edit,
  Package,
  Download
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { productionPlanningApi } from '@/lib/api/production-planning';
import { buildGanttPrintHtml } from './gantt-print-html';

interface BOMPartRequirement {
  id: string;
  partId: string;
  partNumber: string;
  partName: string;
  requiredQuantity: number;
  consumedQuantity: number;
  availableQuantity: number;
  status: 'AVAILABLE' | 'PARTIAL' | 'SHORTAGE' | 'CONSUMED';
}

interface SubTask {
  id: string;
  name: string;
  description: string;
  assignedOperator: string;
  operatorName: string;
  estimatedDuration: number;
  actualDuration: number | null;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  startTime: string | null;
  endTime: string | null;
  notes: string;
  bomRequirements: BOMPartRequirement[];
}

interface ProcessStep {
  id: string;
  name: string;
  sectionName?: string;
  description?: string;
  sequence: number;
  estimatedDuration: number;
  actualDuration: number | null;
  startDate: string;
  endDate: string;
  responsiblePerson?: string;
  responsiblePersonName?: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  dependencies?: string[];
  subTasks: SubTask[];
  notes?: string;
  bomRequirements: BOMPartRequirement[];
}

interface ScheduleViewProps {
  lotId: string;
}

export const ScheduleView = ({ lotId }: ScheduleViewProps) => {
  // Remove unused state variables
  // const [startDate, setStartDate] = useState<Date>(new Date('2026-02-05'));
  // const [endDate, setEndDate] = useState<Date>(new Date('2026-02-20'));
  const [viewMode, setViewMode] = useState<'weekly' | 'daily' | 'monthly'>('weekly');
  const [editingTask, setEditingTask] = useState<{type: 'process' | 'subtask', id: string, processId?: string, data?: any} | null>(null);
  const [editingBOM, setEditingBOM] = useState<{partNumber: string, subTaskId: string, data: any} | null>(null);
  const [bomFormData, setBomFormData] = useState<any>({});
  const [taskFormData, setTaskFormData] = useState<any>({});
  const [showBOMView, setShowBOMView] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const queryClient = useQueryClient();

  // React Query with staleTime so tab switches don't trigger a re-fetch
  const { data: rawProcessResponse, isLoading } = useQuery({
    queryKey: ['schedule-processes', lotId],
    queryFn: () => productionPlanningApi.getProcessesByLot(lotId),
    enabled: !!lotId,
    staleTime: 5 * 60 * 1000,
  });

  const loading = isLoading || isExporting;

  // Use state for process data (kept for optimistic updates during editing)
  const [processesData, setProcessesData] = useState<ProcessStep[]>([]);
  const processesState = {
    data: processesData,
    setData: setProcessesData
  };

  // Transform raw API response into UI ProcessStep objects
  useEffect(() => {
    const transformProcesses = () => {
      if (!rawProcessResponse) return;

      try {
        const response = rawProcessResponse;

        // apiClient returns the ApiResponse object: { data: [...], error, timestamp }
        const rawArray: any[] = Array.isArray(response)
          ? response
          : Array.isArray((response as any)?.data)
            ? (response as any).data
            : [];

        // Deduplicate by process_sequence — merge subtasks from all duplicate records,
        // then deduplicate subtasks by task name (keeps first occurrence)
        const bySeq = new Map<number, any>();
        rawArray.forEach(p => {
          const seq = p.process_sequence ?? p.processSequence ?? 0;
          const pSubs: any[] = p.subtasks || p.subTasks || [];
          if (!bySeq.has(seq)) {
            bySeq.set(seq, { ...p, subtasks: [...pSubs] });
          } else {
            const canonical = bySeq.get(seq)!;
            const seenNames = new Set(
              (canonical.subtasks as any[]).map((s: any) => (s.task_name || s.taskName || '').toLowerCase())
            );
            pSubs.forEach(s => {
              const name = (s.task_name || s.taskName || '').toLowerCase();
              if (!seenNames.has(name)) {
                seenNames.add(name);
                canonical.subtasks.push(s);
              }
            });
          }
        });
        const processesArray = Array.from(bySeq.values())
          .sort((a, b) => (a.process_sequence ?? a.processSequence ?? 0) - (b.process_sequence ?? b.processSequence ?? 0));
        const transformedProcesses = processesArray.map((process: any) => {
          // Calculate estimated duration from process data or use default
          const estimatedHours = process.estimated_hours || process.estimatedHours || process.estimatedDuration || 
                               (process.planned_start_date && process.planned_end_date ? 
                                 Math.round((new Date(process.planned_end_date).getTime() - new Date(process.planned_start_date).getTime()) / (1000 * 60 * 60)) : 
                                 (process.startDate && process.endDate ? 
                                  Math.round((new Date(process.endDate).getTime() - new Date(process.startDate).getTime()) / (1000 * 60 * 60)) : 
                                  72));
          
          // Determine section based on process name (exact same logic as ProcessPlanning)
          let sectionName = 'Process'; // default
          const processName = (process.process_name || process.processName || '').toLowerCase();
          
          if (processName.includes('raw') || processName.includes('material')) {
            sectionName = 'Raw Material';
          } else if (processName.includes('manufacturing') || processName.includes('conversion') ||
                     processName.includes('process') || processName.includes('production')) {
            sectionName = 'Process';
          } else if (processName.includes('inspection') || processName.includes('quality') ||
                     processName.includes('check') || processName.includes('qc') || processName.includes('test')) {
            sectionName = 'Inspection';
          } else if (processName.includes('pack') || processName.includes('packaging') ||
                     processName.includes('delivery') || processName.includes('ship')) {
            sectionName = 'Packing';
          }

return {
            id: process.id,
            name: process.process_name || process.processName || 'Unnamed Process',
            sectionName: sectionName,
            status: process.status?.toUpperCase() || 'PLANNED',
            estimatedDuration: estimatedHours,
            // Calculate actual duration based on dates and status
            actualDuration: calculateActualHours(
              process.planned_start_date || process.startDate || process.createdAt,
              process.planned_end_date || process.endDate || process.completedAt,
              estimatedHours,
              process.status?.toUpperCase() || 'PLANNED'
            ),
            sequence: process.process_sequence || process.processSequence || 0,
            startDate: process.planned_start_date || process.startDate,
            endDate: process.planned_end_date || process.endDate,
            bomRequirements: [],
            subTasks: (process.subtasks || []).map((subtask: any) => {
              // Calculate estimated duration from subtask data or use default
              const subEstimatedHours = subtask.estimated_hours || subtask.estimatedHours || subtask.estimatedDuration || 
                                      (subtask.planned_start_date && subtask.planned_end_date ? 
                                       Math.round((new Date(subtask.planned_end_date).getTime() - new Date(subtask.planned_start_date).getTime()) / (1000 * 60 * 60)) : 
                                       (subtask.startTime && subtask.endTime ? 
                                        Math.round((new Date(subtask.endTime).getTime() - new Date(subtask.startTime).getTime()) / (1000 * 60 * 60)) : 
                                        24));
              
              // Handle section-prefixed subtasks (same logic as ProcessPlanning)
              const taskName = subtask.task_name || subtask.taskName || 'Unnamed Subtask';
              const sectionPrefixMatch = taskName.match(/^\[([^\]]+)\]/);
              const intendedSectionFromName = sectionPrefixMatch ? sectionPrefixMatch[1] : null;
              const cleanTaskName = taskName.replace(/^\[([^\]]+)\]\s*/, '');
              
              return {
                id: subtask.id,
                name: cleanTaskName || taskName, // Use clean name for display
                taskName: taskName, // Keep original task name with prefix
                originalName: taskName, // Keep original for debugging
                intendedSection: intendedSectionFromName, // Track intended section
                status: (subtask.status || 'PENDING').toString().toUpperCase(),
                estimatedDuration: subEstimatedHours,
                // Calculate actual duration based on dates and status
                actualDuration: calculateActualHours(
                  subtask.planned_start_date || subtask.startTime || subtask.createdAt,
                  subtask.planned_end_date || subtask.endTime || subtask.completedAt,
                  subEstimatedHours,
                  subtask.status?.toUpperCase() || 'PENDING'
                ),
                startTime: subtask.planned_start_date || subtask.startTime,
                endTime: subtask.planned_end_date || subtask.endTime,
                operatorName: subtask.assigned_operator || subtask.assignedOperator || subtask.responsiblePerson || '',
                responsiblePersonName: subtask.assigned_operator || subtask.assignedOperator || subtask.responsiblePerson || 'Unassigned',
                bomRequirements: (() => {
                  const rawBomReqs = subtask.bom_requirements || subtask.bomRequirements || [];
                  return rawBomReqs.map((bomReq: any, index: number) => ({
                    id: bomReq.id || bomReq.bom_item_id || `bom-${index}`,
                    partId: bomReq.bomItemId || bomReq.bom_item_id || bomReq.id,
                    partNumber: bomReq.partNumber || bomReq.part_number || bomReq.bom_item?.part_number || 'N/A',
                    partName: bomReq.partName || bomReq.part_name || bomReq.name || bomReq.bom_item?.name || bomReq.bom_item?.part_number || 'Unnamed Part',
                    requiredQuantity: bomReq.requiredQuantity || bomReq.required_quantity || bomReq.quantity || 0,
                    consumedQuantity: bomReq.consumedQuantity || bomReq.consumed_quantity || 0,
                    availableQuantity: bomReq.availableQuantity || bomReq.available_quantity || 0,
                    unit: bomReq.unit || 'units',
                    status: bomReq.status?.toUpperCase() || (bomReq.available_quantity > 0 ? 'AVAILABLE' : 'SHORTAGE')
                  }));
                })()
              };
            })
          };
        });
        
        processesState.setData(transformedProcesses);
      } catch (error) {
        processesState.setData([]);
      }
    };

    transformProcesses();
  }, [rawProcessResponse]);

  const processes = processesState.data;
  
  // Define section order to match ProcessPlanning
  const sectionOrder = ['Raw Material', 'Process', 'Inspection', 'Packing'];
  
  // Group processes by section - for UI display
  const groupedProcesses = (() => {
    const groups: Record<string, ProcessStep[]> = {};
    
    // Initialize all sections
    sectionOrder.forEach(section => {
      groups[section] = [];
    });
    
    // Guard against undefined processes
    if (!processes || !Array.isArray(processes)) {
      return groups;
    }
    
    // Group processes by their section, handling cross-section subtasks properly
    processes.forEach(process => {
      const processSection = process.sectionName || 'Process';
      
      // Separate subtasks by intended section
      const subtasksBySection: Record<string, any[]> = {};
      sectionOrder.forEach(section => {
        subtasksBySection[section] = [];
      });
      
      // Guard against undefined subTasks
      if (process.subTasks && Array.isArray(process.subTasks)) {
        process.subTasks.forEach(subtask => {
        // Extract intended section from task name (use correct property from API)
        const taskName = subtask.name || '';
        const sectionMatch = taskName.match(/^\[([^\]]+)\]/);
        const intendedSection = sectionMatch ? sectionMatch[1] : processSection;
        
        if (intendedSection && subtasksBySection[intendedSection]) {
          // Clean the task name by removing section prefix
          const cleanTaskName = taskName.replace(/^\[([^\]]+)\]\s*/, '');
          const processedSubtask = {
            ...subtask,
            name: cleanTaskName || taskName
          };
          subtasksBySection[intendedSection].push(processedSubtask);
        } else {
          // Default to process section if intended section not found
          if (subtasksBySection[processSection]) {
            subtasksBySection[processSection].push(subtask);
          }
        }
        });
      }
      
      // Add process to its main section with only its own subtasks
      const processWithMainSubtasks = {
        ...process,
        subTasks: subtasksBySection[processSection] || []
      };
      if (groups[processSection]) {
        groups[processSection].push(processWithMainSubtasks);
      }
      
      // Add cross-section subtasks to their intended sections as separate entries
      sectionOrder.forEach(section => {
        if (section !== processSection && subtasksBySection[section] && subtasksBySection[section].length > 0) {
          const crossSectionProcess: ProcessStep = {
            ...process,
            id: `${process.id}-${section}`,
            name: `${section} Tasks`,
            subTasks: subtasksBySection[section] || [],
            sectionName: section,
            isVirtual: true
          } as ProcessStep;
          if (groups[section]) {
            groups[section].push(crossSectionProcess);
          }
        }
      });
    });
    
    return groups;
  })();
  
  // Group subtasks by section for PDF export only - avoids duplication
  const groupedSubtasksForPDF = (() => {
    const groups: Record<string, any[]> = {};
    
    // Initialize all sections
    sectionOrder.forEach(section => {
      groups[section] = [];
    });
    
    // Collect all subtasks and assign them to sections based on their task name prefix
    // Guard against undefined processes
    if (!processes || !Array.isArray(processes)) {
      return groups;
    }
    
    processes.forEach(process => {
      process.subTasks?.forEach(subtask => {
        // Extract intended section from task name prefix
        const taskName = subtask.name || '';
        const sectionMatch = taskName.match(/^\[([^\]]+)\]/);
        const intendedSection = sectionMatch ? sectionMatch[1] : process.sectionName || 'Process';
        
        // Clean the task name by removing section prefix for display
        const cleanTaskName = taskName.replace(/^\[([^\]]+)\]\s*/, '') || taskName;
        
        // Add subtask to the intended section
        if (intendedSection && groups[intendedSection]) {
          groups[intendedSection].push({
            ...subtask,
            name: cleanTaskName,
            processId: process.id,
            processName: process.name
          });
        }
      });
    });
    
    return groups;
  })();
  
  const displayProcesses = processes || [];

  // Helper function to calculate actual hours based on dates
  const calculateActualHours = (startDate: string | null, endDate: string | null, estimatedHours: number, status: string) => {
    if (!startDate && status !== 'PLANNED') return 0;
    
    const start = startDate ? new Date(startDate) : null;
    const now = new Date();
    const end = endDate ? new Date(endDate) : null;
    
    if (status === 'COMPLETED' && start && end) {
      // If completed, calculate hours between start and end date
      const diffMs = end.getTime() - start.getTime();
      const hours = Math.round(diffMs / (1000 * 60 * 60));
      return Math.max(0, hours); // Don't cap at estimated hours, show actual time taken
    } else if (status === 'IN_PROGRESS' && start) {
      // If in progress, calculate hours from start to now
      const diffMs = now.getTime() - start.getTime();
      const hours = Math.round(diffMs / (1000 * 60 * 60));
      return Math.max(0, hours); // Don't cap, show actual progress
    } else if (status === 'PLANNED' || status === 'PENDING') {
      // For planned/pending tasks, return estimated hours
      return estimatedHours;
    }
    
    return 0;
  };

  // Removed unused utility functions: getStatusColor, getStatusIcon, getBOMStatusColor

  // Handle BOM edit form initialization
  const handleEditBOM = (bomItem: any, subTaskId: string) => {
    setEditingBOM({
      partNumber: bomItem.partNumber,
      subTaskId: subTaskId,
      data: bomItem
    });
    setBomFormData({
      partNumber: bomItem.partNumber,
      partName: bomItem.partName,
      requiredQuantity: bomItem.requiredQuantity,
      consumedQuantity: bomItem.consumedQuantity || 0,
      unit: bomItem.unit,
      status: bomItem.status || 'AVAILABLE',
      notes: ''
    });
  };

  // Removed unused handleEditProcess function

  // Handle SubTask edit form initialization
  const handleEditSubTask = (subTask: SubTask, processId: string) => {
    setEditingTask({
      type: 'subtask',
      id: subTask.id,
      processId: processId,
      data: subTask
    });
    setTaskFormData({
      name: subTask.name,
      description: subTask.description || '',
      estimatedDuration: subTask.estimatedDuration,
      startTime: subTask.startTime ? new Date(subTask.startTime).toISOString().split('T')[0] : '',
      endTime: subTask.endTime ? new Date(subTask.endTime).toISOString().split('T')[0] : '',
      status: subTask.status,
      assignedOperator: subTask.operatorName || '',
      notes: subTask.notes || ''
    });
  };

  // Handle Task save (both Process and SubTask)
  const handleSaveTask = async () => {
    if (!editingTask) return;

    try {
      if (editingTask.type === 'process') {
        // Update process optimistically
        if (!processes || !Array.isArray(processes)) return;
        const updatedProcesses = processes.map(process => {
          if (process.id === editingTask.id) {
            return {
              ...process,
              name: taskFormData.name,
              description: taskFormData.description,
              estimatedDuration: Number(taskFormData.estimatedDuration),
              startDate: taskFormData.startDate,
              endDate: taskFormData.endDate,
              status: taskFormData.status,
              responsiblePersonName: taskFormData.responsiblePerson,
              notes: taskFormData.notes
            };
          }
          return process;
        });
        processesState.setData(updatedProcesses);
        
        // Here you would normally call an API to persist the changes
        // await productionPlanningApi.updateProcess(editingTask.id, taskFormData);
        
      } else if (editingTask.type === 'subtask') {
        // Update subtask optimistically
        if (!processes || !Array.isArray(processes)) return;
        const updatedProcesses = processes.map(process => {
          if (process.id === editingTask.processId) {
            return {
              ...process,
              subTasks: process.subTasks.map(subTask => {
                if (subTask.id === editingTask.id) {
                  return {
                    ...subTask,
                    name: taskFormData.name,
                    description: taskFormData.description,
                    estimatedDuration: Number(taskFormData.estimatedDuration),
                    startTime: taskFormData.startTime,
                    endTime: taskFormData.endTime,
                    status: taskFormData.status,
                    operatorName: taskFormData.assignedOperator,
                    responsiblePersonName: taskFormData.assignedOperator,
                    notes: taskFormData.notes
                  };
                }
                return subTask;
              })
            };
          }
          return process;
        });
        processesState.setData(updatedProcesses);
        
        // Here you would normally call an API to persist the changes
        // await productionPlanningApi.updateSubTask(editingTask.id, taskFormData);
      }

      // Close dialog
      setEditingTask(null);
      setTaskFormData({});
      
    } catch (error) {
      // Revert optimistic update on error
    }
  };

  // Handle BOM save
  const handleSaveBOM = async () => {
    if (!editingBOM) return;

    try {
      // Update the BOM data optimistically
      if (!processes || !Array.isArray(processes)) return;
      const updatedProcesses = processes.map(process => ({
        ...process,
        subTasks: process.subTasks.map(subTask => {
          if (subTask.id === editingBOM.subTaskId) {
            return {
              ...subTask,
              bomRequirements: subTask.bomRequirements.map(bom => {
                if (bom.partNumber === editingBOM.partNumber) {
                  return {
                    ...bom,
                    requiredQuantity: bomFormData.requiredQuantity,
                    consumedQuantity: bomFormData.consumedQuantity,
                    unit: bomFormData.unit,
                    status: bomFormData.status
                  };
                }
                return bom;
              })
            };
          }
          return subTask;
        })
      }));

      // Update state optimistically
      processesState.setData(updatedProcesses);
      
      // Close dialog
      setEditingBOM(null);
      setBomFormData({});
      
      // Here you would normally call an API to persist the changes
      // await productionPlanningApi.updateBOMProgress(editingBOM.subTaskId, bomFormData);
      
    } catch (error) {
      // Revert optimistic update on error
      // You might want to show a toast notification here
    }
  };

  // Force a fresh fetch (used by PDF export)
  const fetchLatestData = async () => {
    if (!lotId) return;
    await queryClient.invalidateQueries({ queryKey: ['schedule-processes', lotId] });
  };

  // Export to PDF functionality
  const exportToPDF = async () => {
    try {
      // First refresh the data to ensure we have the latest information
      setIsExporting(true);
      await fetchLatestData();
      setIsExporting(false);

      // Create a new window for the PDF content
      const printWindow = window.open('', '_blank', 'width=1200,height=800');
      if (!printWindow) {
        return;
      }

      // Generate PDF-optimized HTML content with fresh data
      const pdfContent = generatePDFContent();
      
      // Secure PDF content insertion
      if (printWindow.document.body) {
        printWindow.document.body.innerHTML = pdfContent;
      }
      
      // Wait for content to load, then trigger save as PDF
      setTimeout(() => {
        printWindow.focus();
        // Use execCommand to save as PDF if supported, otherwise use print
        if (printWindow.document.execCommand) {
          try {
            printWindow.document.execCommand('SaveAs', true, `Production_Gantt_${lotId}_${new Date().toISOString().split('T')[0]}.pdf`);
          } catch (e) {
            printWindow.print();
          }
        } else {
          printWindow.print();
        }
      }, 1000);
      
    } catch (error) {
      }
  };

  // Printable page for the PDF export: built only through buildGanttPrintHtml, which escapes every value it interpolates.
  const generatePDFContent = () =>
    buildGanttPrintHtml({
      lotId,
      viewMode,
      sections: sectionOrder.map((name) => ({ name, subTasks: groupedSubtasksForPDF[name] ?? [] })),
      hasProcesses: displayProcesses.length > 0,
      showBom: showBOMView,
      totalTasks,
      completedTasks,
      now: new Date(),
    });

  // Calculate metrics from data structure when no real processes exist
  const totalTasks = displayProcesses.length === 0 ? 10 : displayProcesses.reduce((sum, p) => sum + (p.subTasks?.length || 0) + 1, 0);
  const inProgressTasks = displayProcesses.length === 0 ? 0 : displayProcesses.filter(p => p.status === 'IN_PROGRESS').length + 
                          displayProcesses.flatMap(p => p.subTasks || []).filter(st => st.status === 'IN_PROGRESS').length;
  const completedTasks = displayProcesses.length === 0 ? 1 : displayProcesses.filter(p => p.status === 'COMPLETED').length + 
                         displayProcesses.flatMap(p => p.subTasks || []).filter(st => st.status === 'COMPLETED').length;

  // Removed unused processColors

  return (
    <div className="space-y-6">

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalTasks}</div>
            <p className="text-xs text-muted-foreground">
              Including sub-tasks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <PlayCircle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{inProgressTasks}</div>
            <p className="text-xs text-muted-foreground">
              Active tasks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedTasks}</div>
            <p className="text-xs text-muted-foreground">
              Finished tasks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hours</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {(() => {
              const totalEstimatedHours = displayProcesses.reduce((sum, process) => {
                const processHours = process.estimatedDuration || 0;
                const subTaskHours = (process.subTasks || []).reduce((subSum, subTask) => 
                  subSum + (subTask.estimatedDuration || 0), 0);
                return sum + processHours + subTaskHours;
              }, 0);
              
              const totalActualHours = displayProcesses.reduce((sum, process) => {
                const processHours = process.actualDuration || 0;
                const subTaskHours = (process.subTasks || []).reduce((subSum, subTask) => 
                  subSum + (subTask.actualDuration || 0), 0);
                return sum + processHours + subTaskHours;
              }, 0);

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-bold">{totalEstimatedHours}h</span>
                    <Badge variant="outline" className="text-xs">
                      Estimated
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-lg text-muted-foreground">{totalActualHours}h</span>
                    <Badge variant={totalActualHours > 0 ? "default" : "secondary"} className="text-xs">
                      Actual
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Progress: {totalEstimatedHours > 0 ? Math.round((totalActualHours / totalEstimatedHours) * 100) : 0}%
                  </p>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

{/* Gantt Chart */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Production Tracking</CardTitle>
              <CardDescription>
                Gantt chart showing timeline and dependencies for all processes
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                size="sm" 
                variant={viewMode === 'weekly' ? 'default' : 'outline'}
                onClick={() => setViewMode('weekly')}
              >
                Weekly
              </Button>
              <Button 
                size="sm" 
                variant={viewMode === 'daily' ? 'default' : 'outline'}
                onClick={() => setViewMode('daily')}
              >
                Daily
              </Button>
              <Button 
                size="sm" 
                variant={viewMode === 'monthly' ? 'default' : 'outline'}
                onClick={() => setViewMode('monthly')}
              >
                Monthly
              </Button>
              <Button 
                size="sm" 
                variant={showBOMView ? 'default' : 'outline'}
                onClick={() => setShowBOMView(!showBOMView)}
              >
                <Package className="h-3 w-3 mr-1" />
                BOM View
              </Button>
              <Button 
                size="sm" 
                variant="outline"
                onClick={exportToPDF}
                className="bg-green-50 hover:bg-green-100 text-green-700 border-green-200"
              >
                <Download className="h-3 w-3 mr-1" />
                Export PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            {/* Header Row */}
            <div className="flex items-center bg-muted/40 border-b">
              <div className="w-80 p-3 border-r font-medium text-sm">Task</div>
              <div className={`flex-1 grid text-xs ${
                viewMode === 'weekly' ? 'grid-cols-10' : 
                viewMode === 'daily' ? 'grid-cols-7' : 
                'grid-cols-6'
              }`}>
                {(() => {
                  // Calculate date range dynamically based on view mode
                  const today = new Date();
                  const startDate = new Date(today);
                  
                  // Generate date columns based on view mode
                  const columnCount = viewMode === 'weekly' ? 10 : viewMode === 'daily' ? 7 : 6;
                  const dates = [];
                  
                  for (let i = 0; i < columnCount; i++) {
                    const currentDate = new Date(startDate);
                    
                    if (viewMode === 'weekly') {
                      currentDate.setDate(startDate.getDate() + (i * 7));
                      dates.push({
                        date: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        period: `Week ${i + 1}`
                      });
                    } else if (viewMode === 'daily') {
                      currentDate.setDate(startDate.getDate() + i);
                      dates.push({
                        date: currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                        period: currentDate.toLocaleDateString('en-US', { weekday: 'short' })
                      });
                    } else {
                      currentDate.setMonth(startDate.getMonth() + i);
                      dates.push({
                        date: currentDate.toLocaleDateString('en-US', { month: 'short' }),
                        period: `Month ${i + 1}`
                      });
                    }
                  }
                  
                  return dates.map((item, i) => (
                    <div key={i} className="p-2 text-center border-r border-muted/30 font-medium">
                      {viewMode === 'daily' ? (
                        <div className="font-medium text-xs">
                          {item.date} <span className="text-muted-foreground">{item.period}</span>
                        </div>
                      ) : (
                        <>
                          <div className="font-medium">{item.date}</div>
                          <div className="text-muted-foreground text-xs">{item.period}</div>
                        </>
                      )}
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Process Rows */}
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <span className="ml-2 text-muted-foreground">Loading processes...</span>
              </div>
            ) : displayProcesses.length === 0 ? (
              <div className="flex items-center justify-center p-8">
                <div className="text-center">
                  <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground">No Processes Found</h3>
                  <p className="text-sm text-muted-foreground">Create processes in the Process tab to see them here.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {sectionOrder.map((sectionName) => {
                  const sectionProcesses = groupedProcesses[sectionName] || [];
                  
                  return (
                    <div key={sectionName} className="space-y-2">
                      {/* Section header */}
                      <div className="flex items-center group bg-muted/10 p-2 rounded">
                        <div className="w-80 pr-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center text-white text-xs font-bold">
                                {sectionOrder.indexOf(sectionName) + 1}
                              </div>
                              <div>
                                <div className="font-medium text-sm">{sectionName}</div>
                                <div className="text-xs text-muted-foreground">
                                  {sectionProcesses.reduce((total, p) => total + (p.subTasks?.reduce((subTotal, subTask) => subTotal + (subTask.bomRequirements?.length || 0), 0) || 0), 0)} BOM parts
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className="text-xs" variant="outline">
                                PENDING
                              </Badge>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        <div className={`flex-1 grid gap-1 ${
                          viewMode === 'weekly' ? 'grid-cols-10' : 
                          viewMode === 'daily' ? 'grid-cols-7' : 
                          'grid-cols-6'
                        }`}>
                          {Array.from({
                            length: viewMode === 'weekly' ? 10 : viewMode === 'daily' ? 7 : 6
                          }, (_, dayIndex) => {
                            // Section header shows weeks/days/months
                            const isInTimeRange = dayIndex < 3; // Show first 3 columns for section header
                            
                            return (
                              <div key={dayIndex} className="relative h-6 bg-muted/20 rounded border-l border-muted/30">
                                {isInTimeRange && (
                                  <div className="absolute inset-0 bg-primary/60 rounded flex items-center justify-center">
                                    <span className="text-white text-xs font-medium">
                                      {viewMode === 'daily' ? `Wk ${dayIndex + 1}` : 
                                       viewMode === 'weekly' ? `Wk ${dayIndex + 1}` : 
                                       `Wk ${dayIndex + 1}`}
                                    </span>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Sub-processes under the section */}
                      {sectionProcesses.length === 0 ? (
                        <div className="ml-4 p-3 bg-muted/5 rounded border-l-2 border-dashed border-muted/50">
                          <p className="text-sm text-muted-foreground">No processes in {sectionName} section</p>
                        </div>
                      ) : (
                        sectionProcesses.map((process) => (
                        <React.Fragment key={process.id}>
                          {process.subTasks && process.subTasks.map((subTask, subTaskIndex) => (
                          <div key={subTask.id} className="space-y-2">
                        {/* Sub-task row */}
                        <div className="flex items-center ml-4 group border-l-2 border-dashed border-muted pl-4">
                          <div className="w-76 pr-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-5 h-5 bg-secondary rounded-full flex items-center justify-center text-xs font-medium">
                                  {subTaskIndex + 1}
                                </div>
                                <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
                                <div>
                                  <div className="font-medium text-xs">{subTask.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {subTask.operatorName || 'Unassigned'} • {subTask.bomRequirements?.length || 0} BOM parts
                                  </div>
                                </div>
                              </div>
                              <Badge className="text-xs" variant="outline">
                                {subTask.status}
                              </Badge>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
                              onClick={() => handleEditSubTask(subTask, process.id)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className={`flex-1 grid gap-1 ${
                            viewMode === 'weekly' ? 'grid-cols-10' : 
                            viewMode === 'daily' ? 'grid-cols-7' : 
                            'grid-cols-6'
                          }`}>
                            {Array.from({
                              length: viewMode === 'weekly' ? 10 : viewMode === 'daily' ? 7 : 6
                            }, (_, dayIndex) => {
                              // Calculate timeline position based on actual dates
                              const today = new Date();
                              const startDate = new Date(today);
                              
                              // Calculate the date for this column
                              let columnDate;
                              if (viewMode === 'weekly') {
                                columnDate = new Date(startDate);
                                columnDate.setDate(startDate.getDate() + (dayIndex * 7));
                              } else if (viewMode === 'daily') {
                                columnDate = new Date(startDate);
                                columnDate.setDate(startDate.getDate() + dayIndex);
                              } else {
                                columnDate = new Date(startDate);
                                columnDate.setMonth(startDate.getMonth() + dayIndex);
                              }
                              
                              // Check if subtask should be displayed in this column
                              const subTaskStartTime = subTask.startTime ? new Date(subTask.startTime) : null;
                              const subTaskEndTime = subTask.endTime ? new Date(subTask.endTime) : null;
                              
                              let isInTimeRange = false;
                              
                              if (subTaskStartTime && subTaskEndTime) {
                                // Check if the column date falls within the task date range
                                if (viewMode === 'weekly') {
                                  const columnEndDate = new Date(columnDate);
                                  columnEndDate.setDate(columnDate.getDate() + 6); // End of week
                                  isInTimeRange = (columnDate <= subTaskEndTime && columnEndDate >= subTaskStartTime);
                                } else if (viewMode === 'daily') {
                                  isInTimeRange = (columnDate >= subTaskStartTime && columnDate <= subTaskEndTime);
                                } else {
                                  const columnEndDate = new Date(columnDate);
                                  columnEndDate.setMonth(columnDate.getMonth() + 1, 0); // End of month
                                  isInTimeRange = (columnDate <= subTaskEndTime && columnEndDate >= subTaskStartTime);
                                }
                              } else {
                                // Fallback to progress percentage for tasks without dates
                                const progressPercentage = subTask.actualDuration && subTask.estimatedDuration ? 
                                  (subTask.actualDuration / subTask.estimatedDuration) * 100 : 0;
                                const columnCount = viewMode === 'weekly' ? 10 : viewMode === 'daily' ? 7 : 6;
                                isInTimeRange = dayIndex < Math.ceil((progressPercentage / 100) * columnCount) || dayIndex < 3;
                              }
                              
                              return (
                                <div key={dayIndex} className="relative h-6 bg-muted/10 rounded cursor-pointer hover:bg-muted/20 border-l border-muted/30">
                                  {isInTimeRange && (
                                    <div 
                                      className="absolute top-1 h-4 rounded flex items-center justify-center px-1"
                                      style={{
                                        backgroundColor: (() => {
                                          
                                          switch(subTask.status) {
                                            case 'IN_PROGRESS': return 'rgb(251, 146, 60)'; // Orange
                                            case 'COMPLETED': return 'rgb(34, 197, 94)';    // Green
                                            case 'PENDING': return 'rgb(156, 163, 175)';    // Gray
                                            default: return 'rgb(251, 146, 60)';           // Default orange
                                          }
                                        })(),
                                        left: '0%',
                                        width: '100%',
                                        opacity: 0.8
                                      }}
                                    >
                                      {dayIndex === 0 || (!subTaskStartTime && !subTaskEndTime) ? (
                                        <div className="text-white text-xs truncate">{subTask.name}</div>
                                      ) : (
                                        <div className="text-white text-xs font-medium text-center">
                                          {(() => {
                                            const startDate = subTaskStartTime ? subTaskStartTime.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) : '';
                                            const endDate = subTaskEndTime ? subTaskEndTime.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }) : '';
                                            
                                            if (viewMode === 'daily' && subTaskStartTime && subTaskEndTime) {
                                              // Show specific dates for daily view
                                              if (columnDate.toDateString() === subTaskStartTime.toDateString()) {
                                                return <span className="text-[10px]">Start</span>;
                                              } else if (columnDate.toDateString() === subTaskEndTime.toDateString()) {
                                                return <span className="text-[10px]">End</span>;
                                              } else {
                                                return <span className="text-[10px]">•</span>;
                                              }
                                            } else if (startDate && endDate) {
                                              return (
                                                <div className="flex flex-col leading-tight">
                                                  <span className="text-[9px]">{startDate}</span>
                                                  <span className="text-[9px]">{endDate}</span>
                                                </div>
                                              );
                                            } else if (startDate) {
                                              return <span className="text-[10px]">{startDate}</span>;
                                            } else if (endDate) {
                                              return <span className="text-[10px]">{endDate}</span>;
                                            } else {
                                              return <span className="text-[10px]">•</span>;
                                            }
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* BOM Requirements for this specific sub-task */}
                        {showBOMView && subTask.bomRequirements && subTask.bomRequirements.map((bomItem, bomIndex) => (
                          <div key={`${subTask.id}-${bomItem.partNumber}`} className="flex items-center ml-8 group border-l-2 border-dotted border-muted pl-6">
                            <div className="w-72 pr-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <div className="w-4 h-4 bg-blue-500/20 rounded-full flex items-center justify-center text-xs font-medium">
                                    {bomIndex + 1}
                                  </div>
                                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                  <div>
                                    <div className="font-medium text-xs">{bomItem.partNumber}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {bomItem.partName} • Qty: {bomItem.requiredQuantity || 0}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge className="text-xs" variant="outline">
                                    pcs
                                  </Badge>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
                                    onClick={() => handleEditBOM(bomItem, subTask.id)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                            <div className={`flex-1 grid gap-1 ${
                              viewMode === 'weekly' ? 'grid-cols-10' : 
                              viewMode === 'daily' ? 'grid-cols-7' : 
                              'grid-cols-6'
                            }`}>
                              {Array.from({
                                length: viewMode === 'weekly' ? 10 : viewMode === 'daily' ? 7 : 6
                              }, (_, dayIndex) => {
                                // Calculate timeline position based on parent subtask dates
                                const today = new Date();
                                const startDate = new Date(today);
                                
                                let columnDate;
                                if (viewMode === 'weekly') {
                                  columnDate = new Date(startDate);
                                  columnDate.setDate(startDate.getDate() + (dayIndex * 7));
                                } else if (viewMode === 'daily') {
                                  columnDate = new Date(startDate);
                                  columnDate.setDate(startDate.getDate() + dayIndex);
                                } else {
                                  columnDate = new Date(startDate);
                                  columnDate.setMonth(startDate.getMonth() + dayIndex);
                                }
                                
                                // BOM should be aligned with its parent subtask
                                const subTaskStartTime = subTask.startTime ? new Date(subTask.startTime) : null;
                                const subTaskEndTime = subTask.endTime ? new Date(subTask.endTime) : null;
                                
                                let isInTimeRange = false;
                                
                                if (subTaskStartTime && subTaskEndTime) {
                                  if (viewMode === 'weekly') {
                                    const columnEndDate = new Date(columnDate);
                                    columnEndDate.setDate(columnDate.getDate() + 6);
                                    isInTimeRange = (columnDate <= subTaskEndTime && columnEndDate >= subTaskStartTime);
                                  } else if (viewMode === 'daily') {
                                    isInTimeRange = (columnDate >= subTaskStartTime && columnDate <= subTaskEndTime);
                                  } else {
                                    const columnEndDate = new Date(columnDate);
                                    columnEndDate.setMonth(columnDate.getMonth() + 1, 0);
                                    isInTimeRange = (columnDate <= subTaskEndTime && columnEndDate >= subTaskStartTime);
                                  }
                                } else {
                                  // Fallback to consumption percentage
                                  const consumptionPercentage = bomItem.requiredQuantity > 0 ? 
                                    Math.min(100, ((bomItem.consumedQuantity || 0) / bomItem.requiredQuantity) * 100) : 0;
                                  const columnCount = viewMode === 'weekly' ? 10 : viewMode === 'daily' ? 7 : 6;
                                  isInTimeRange = dayIndex < Math.ceil((consumptionPercentage / 100) * columnCount) || dayIndex < 2;
                                }
                                
                                return (
                                  <div key={dayIndex} className="relative h-5 bg-muted/10 rounded cursor-pointer hover:bg-muted/20 border-l border-muted/30">
                                    {isInTimeRange && (
                                      <div 
                                        className="absolute top-0.5 h-4 rounded flex items-center justify-center px-1"
                                        style={{
                                          backgroundColor: bomItem.status === 'AVAILABLE' ? 'rgba(59, 130, 246, 0.7)' : 
                                                         bomItem.status === 'PARTIAL' ? 'rgba(234, 179, 8, 0.7)' : 
                                                         bomItem.status === 'SHORTAGE' ? 'rgba(239, 68, 68, 0.7)' :
                                                         'rgba(59, 130, 246, 0.7)',
                                          left: '0%',
                                          width: '100%',
                                          opacity: 0.7
                                        }}
                                      >
                                        {dayIndex === 0 ? (
                                          <div className="text-white text-xs truncate">{bomItem.partNumber}</div>
                                        ) : (
                                          <span className="text-white text-xs font-medium">
                                            {bomItem.consumedQuantity || 0}/{bomItem.requiredQuantity || 0}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          ))}
                          </div>
                        ))}
                        </React.Fragment>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {/* BOM Status Colors */}
            <div>
              <div className="text-sm font-medium mb-2">BOM Status Colors:</div>
              <div className="flex flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-green-500"></div>
                  <span className="text-sm">Available</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-yellow-500"></div>
                  <span className="text-sm">Partial</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-red-500"></div>
                  <span className="text-sm">Shortage</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-gray-500"></div>
                  <span className="text-sm">Pending</span>
                </div>
              </div>
            </div>

            <div className="border-l border-muted pl-4 ml-2">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Progress:</div>
                <div className="text-xs text-muted-foreground">hours completed</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">Status:</div>
                <div className="text-xs text-muted-foreground">IN_PROGRESS, PLANNED, COMPLETED</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit BOM Dialog */}
      {editingBOM && (
        <Dialog open={!!editingBOM} onOpenChange={() => setEditingBOM(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit BOM Part Progress</DialogTitle>
              <DialogDescription>
                Update progress and status for {editingBOM.data.partNumber} - {editingBOM.data.partName}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Part Number</label>
                  <input 
                    type="text" 
                    value={bomFormData.partNumber || ''}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md bg-muted"
                    disabled
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Required Qty</label>
                  <input 
                    type="number"
                    value={bomFormData.requiredQuantity || 0}
                    onChange={(e) => setBomFormData({...bomFormData, requiredQuantity: Number(e.target.value)})}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Consumed Qty</label>
                  <input 
                    type="number"
                    value={bomFormData.consumedQuantity || 0}
                    onChange={(e) => setBomFormData({...bomFormData, consumedQuantity: Number(e.target.value)})}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Unit</label>
                  <input 
                    type="text"
                    value={bomFormData.unit || ''}
                    onChange={(e) => setBomFormData({...bomFormData, unit: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Status</label>
                <select 
                  value={bomFormData.status || 'AVAILABLE'}
                  onChange={(e) => setBomFormData({...bomFormData, status: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                >
                  <option value="AVAILABLE">Available (Green)</option>
                  <option value="PARTIAL">Partial (Yellow)</option>
                  <option value="SHORTAGE">Shortage (Red)</option>
                  <option value="PENDING">Pending (Gray)</option>
                </select>
              </div>

            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingBOM(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveBOM}>
                Save Progress
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Task Dialog (Process & SubTask) */}
      {editingTask && (
        <Dialog open={!!editingTask} onOpenChange={() => setEditingTask(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {editingTask.type === 'process' ? 'Edit Process' : 'Edit Sub-Task'}
              </DialogTitle>
              <DialogDescription>
                {editingTask.type === 'process' 
                  ? 'Modify process details, timing, dates, and status'
                  : 'Modify subtask details, timing, hours, and status'
                }
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">
                  {editingTask.type === 'process' ? 'Process Name' : 'Task Name'}
                </label>
                <input 
                  type="text" 
                  value={taskFormData.name || ''}
                  onChange={(e) => setTaskFormData({...taskFormData, name: e.target.value})}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                  placeholder={editingTask.type === 'process' ? 'Enter process name' : 'Enter task name'}
                />
              </div>

<div>
                <label className="text-sm font-medium">Duration (hours)</label>
                <input 
                  type="number"
                  value={taskFormData.estimatedDuration || 0}
                  onChange={(e) => setTaskFormData({...taskFormData, estimatedDuration: Number(e.target.value)})}
                  className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                  placeholder="Enter duration in hours"
                  step="0.5"
                  min="0"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">
                    {editingTask.type === 'process' ? 'Responsible Person' : 'Assigned Operator'}
                  </label>
                  <input 
                    type="text"
                    value={editingTask.type === 'process' ? (taskFormData.responsiblePerson || '') : (taskFormData.assignedOperator || '')}
                    onChange={(e) => {
                      const field = editingTask.type === 'process' ? 'responsiblePerson' : 'assignedOperator';
                      setTaskFormData({...taskFormData, [field]: e.target.value});
                    }}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                    placeholder={editingTask.type === 'process' ? 'Enter responsible person' : 'Enter operator name'}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Status</label>
                  <select 
                    value={taskFormData.status || (editingTask.type === 'process' ? 'PLANNED' : 'PENDING')}
                    onChange={(e) => setTaskFormData({...taskFormData, status: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                  >
                    {editingTask.type === 'process' ? (
                      <>
                        <option value="PLANNED">Planned</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="BLOCKED">Blocked</option>
                      </>
                    ) : (
                      <>
                        <option value="PENDING">Pending</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="BLOCKED">Blocked</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {editingTask.type === 'process' && (
                <div>
                  <label className="text-sm font-medium">Description</label>
                  <textarea 
                    value={taskFormData.description || ''}
                    onChange={(e) => setTaskFormData({...taskFormData, description: e.target.value})}
                    className="w-full mt-1 px-3 py-2 border border-input rounded-md"
                    rows={3}
                    placeholder="Enter process description"
                  />
                </div>
              )}


            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingTask(null)}>
                Cancel
              </Button>
              <Button onClick={handleSaveTask}>
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};
