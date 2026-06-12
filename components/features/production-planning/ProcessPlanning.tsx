'use client';

import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Settings,
  CheckCircle,
  AlertTriangle,
  Clock,
  Search,
  Plus,
  Edit,
  Trash2,
  Calendar,
  PlayCircle,
  StopCircle,
  ChevronDown,
  ChevronRight,
  Users,
  Package,
} from 'lucide-react';
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
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { apiClient } from '@/lib/api/client';
import {
  useProductionProcesses,
  useCreateProcessSubtask,
  useUpdateProcessSubtask,
  useDeleteProcessSubtask,
  useCreateProductionProcess,
  PRODUCTION_PLANNING_QUERY_KEYS,
} from '@/lib/api/hooks/useProductionPlanning';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BOMPartRequirement {
  id: string;
  partId: string;
  partNumber: string;
  partName: string;
  requiredQuantity: number;
  status: 'AVAILABLE' | 'PARTIAL' | 'SHORTAGE' | 'CONSUMED';
}

interface SubTask {
  id: string;
  name: string;
  description: string;
  operatorName: string;
  estimatedDuration: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  notes: string;
  bomRequirements: BOMPartRequirement[];
}

interface ProcessStep {
  id: string;           // DB UUID when available, 'section-N' fallback
  dbId: string | null;  // always the DB UUID (null if not yet in DB)
  name: string;
  description: string;
  sequence: number;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED';
  subTasks: SubTask[];
}

interface ProcessPlanningProps {
  lotId: string;
}

// ─── Static section definitions (always rendered) ────────────────────────────

const SECTIONS = [
  { seq: 1, name: 'Raw Material',  description: 'Raw material sourcing, preparation and initial inspection' },
  { seq: 2, name: 'Process',       description: 'Manufacturing and assembly operations' },
  { seq: 3, name: 'Inspection',    description: 'Quality control, testing and verification' },
  { seq: 4, name: 'Packing',       description: 'Final packaging and dispatch preparation' },
] as const;

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapProcessStatus(s: string): ProcessStep['status'] {
  if (s === 'in_progress') return 'IN_PROGRESS';
  if (s === 'completed')   return 'COMPLETED';
  if (s === 'on_hold' || s === 'cancelled') return 'BLOCKED';
  return 'PLANNED';
}

function mapSubtaskStatus(s: string): SubTask['status'] {
  if (s === 'in_progress') return 'IN_PROGRESS';
  if (s === 'completed')   return 'COMPLETED';
  if (s === 'failed' || s === 'skipped') return 'BLOCKED';
  return 'PENDING';
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ProcessPlanning = ({ lotId }: ProcessPlanningProps) => {
  const queryClient = useQueryClient();

  // ── Server data ──────────────────────────────────────────────────────────────
  const { data: apiProcesses, isLoading: processesLoading } = useProductionProcesses(lotId);
  const createSubtaskMutation = useCreateProcessSubtask();
  const updateSubtaskMutation = useUpdateProcessSubtask();
  const deleteSubtaskMutation = useDeleteProcessSubtask();
  const createProcessMutation = useCreateProductionProcess();

  const { data: lotBomItems = [] } = useQuery({
    queryKey: ['lot-bom-items', lotId],
    queryFn: async () => {
      const res = await apiClient.get(`/production-planning/lots/${lotId}/bom-items`);
      return (res as any).data || [];
    },
    enabled: !!lotId,
  });

  // ── Local UI state ────────────────────────────────────────────────────────────
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showNewSubTask, setShowNewSubTask] = useState<string | null>(null); // process id
  const [editingSubTask, setEditingSubTask] = useState<SubTask | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newSubTaskForm, setNewSubTaskForm] = useState({
    name: '',
    description: '',
    operatorName: '',
    estimatedDuration: 2,
    notes: '',
  });
  const [selectedBOM, setSelectedBOM] = useState<Record<string, { selected: boolean; quantity: number }>>({});
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    operatorName: '',
    estimatedDuration: 2,
    notes: '',
    status: 'PENDING' as SubTask['status'],
  });

  // ── Merge static sections with DB data ────────────────────────────────────────
  const processes = useMemo<ProcessStep[]>(() => {
    return SECTIONS.map(section => {
      // Match by sequence number (most reliable)
      const dbProc = (apiProcesses as any[] | undefined)?.find(
        (p: any) => p.process_sequence === section.seq,
      );

      const subTasks: SubTask[] = (dbProc?.subtasks || []).map((st: any) => ({
        id: st.id,
        name: st.task_name,
        description: st.description || '',
        operatorName: st.operator_name || st.assigned_operator || '',
        estimatedDuration: st.estimated_duration_hours || 0,
        status: mapSubtaskStatus(st.status),
        notes: st.notes || '',
        bomRequirements: (st.bom_requirements || []).map((br: any) => ({
          id: br.id,
          partId: br.bom_item_id,
          partNumber: br.bom_item?.part_number || '',
          partName: br.bom_item?.name || '',
          requiredQuantity: br.required_quantity,
          status: 'AVAILABLE' as const,
        })),
      }));

      return {
        id: dbProc?.id ?? `section-${section.seq}`,
        dbId: dbProc?.id ?? null,
        name: section.name,
        description: section.description,
        sequence: section.seq,
        status: dbProc ? mapProcessStatus(dbProc.status) : 'PLANNED',
        subTasks,
      };
    });
  }, [apiProcesses]);

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const getStatusColor = (status: string) => ({
    PLANNED:     'bg-blue-100 text-blue-600',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-600',
    COMPLETED:   'bg-green-100 text-green-600',
    BLOCKED:     'bg-red-100 text-red-600',
    PENDING:     'bg-gray-100 text-gray-600',
  }[status] ?? 'bg-gray-100 text-gray-600');

  const getStatusIcon = (status: string) => ({
    PLANNED:     <Calendar className="h-4 w-4" />,
    IN_PROGRESS: <PlayCircle className="h-4 w-4" />,
    COMPLETED:   <CheckCircle className="h-4 w-4" />,
    BLOCKED:     <StopCircle className="h-4 w-4" />,
    PENDING:     <Clock className="h-4 w-4" />,
  }[status] ?? <AlertTriangle className="h-4 w-4" />);

  const sectionBorder: Record<string, string> = {
    'Raw Material': 'border-l-blue-500',
    'Process':      'border-l-purple-500',
    'Inspection':   'border-l-amber-500',
    'Packing':      'border-l-green-500',
  };
  const sectionNumBg: Record<string, string> = {
    'Raw Material': 'bg-blue-500',
    'Process':      'bg-purple-500',
    'Inspection':   'bg-amber-500',
    'Packing':      'bg-green-500',
  };

  const openEditSubTask = (task: SubTask) => {
    setEditForm({
      name: task.name,
      description: task.description,
      operatorName: task.operatorName,
      estimatedDuration: task.estimatedDuration,
      notes: task.notes,
      status: task.status,
    });
    setEditingSubTask(task);
  };

  const handleUpdateSubTask = async () => {
    if (!editingSubTask || !editForm.name.trim()) return;
    try {
      await updateSubtaskMutation.mutateAsync({
        id: editingSubTask.id,
        lotId,
        data: {
          taskName: editForm.name,
          description: editForm.description || undefined,
          estimatedHours: editForm.estimatedDuration,
          assignedOperator: editForm.operatorName || undefined,
          remarks: editForm.notes || undefined,
          status: editForm.status.toLowerCase(),
        },
      });
      toast.success('Sub-task updated');
      setEditingSubTask(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update sub-task');
    }
  };

  const handleDeleteSubTask = async () => {
    if (!confirmDeleteId) return;
    try {
      await deleteSubtaskMutation.mutateAsync({ id: confirmDeleteId, lotId });
      toast.success('Sub-task deleted');
      setConfirmDeleteId(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to delete sub-task');
    }
  };

  const openAddSubTask = (processId: string) => {
    const init: Record<string, { selected: boolean; quantity: number }> = {};
    (lotBomItems as any[]).forEach((item: any) => {
      init[item.id] = { selected: false, quantity: item.quantity || 1 };
    });
    setSelectedBOM(init);
    setNewSubTaskForm({ name: '', description: '', operatorName: '', estimatedDuration: 2, notes: '' });
    setShowNewSubTask(processId);
  };

  const handleCreateSubTask = async () => {
    if (!showNewSubTask || !newSubTaskForm.name.trim()) return;

    let section = processes.find(p => p.id === showNewSubTask);
    if (!section) return;

    // Auto-initialize the process record in DB if it doesn't exist yet
    let dbId = section.dbId;
    if (!dbId) {
      try {
        const res = await createProcessMutation.mutateAsync({
          lotId,
          data: {
            production_lot_id: lotId,
            process_name: section.name,
            process_sequence: section.sequence,
            description: section.description,
            status: 'pending',
          },
        });
        dbId = (res as any)?.data?.id ?? (res as any)?.id ?? null;
        if (!dbId) {
          toast.error('Failed to initialize process record — please try again.');
          return;
        }
        // Refresh so the section picks up its new dbId
        await queryClient.invalidateQueries({
          queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lotProcesses(lotId),
          exact: false,
        });
      } catch (err: any) {
        toast.error(err?.response?.data?.message || 'Failed to initialize process');
        return;
      }
    }

    const bomParts = (lotBomItems as any[])
      .filter((item: any) => selectedBOM[item.id]?.selected)
      .map((item: any) => ({
        bom_item_id: item.id,
        required_quantity: selectedBOM[item.id].quantity,
        unit: item.unit || 'pcs',
      }));

    const taskSequence = (section.subTasks?.length || 0) + 1;

    try {
      await createSubtaskMutation.mutateAsync({
        processId: dbId,
        data: {
          productionProcessId: dbId,
          taskName: newSubTaskForm.name,
          description: newSubTaskForm.description || undefined,
          taskSequence,
          estimatedHours: newSubTaskForm.estimatedDuration,
          assignedOperator: newSubTaskForm.operatorName || undefined,
          bomParts: bomParts.length > 0 ? bomParts : undefined,
        },
      });

      queryClient.invalidateQueries({
        queryKey: PRODUCTION_PLANNING_QUERY_KEYS.lotProcesses(lotId),
        exact: false,
      });

      toast.success('Sub-task saved');
      setShowNewSubTask(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to save sub-task');
    }
  };

  // ── Filtered view ─────────────────────────────────────────────────────────────

  const filtered = processes.filter(p => {
    const matchSearch = p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                        p.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = filterStatus === 'all' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const totalTasks = processes.reduce((s, p) => s + p.subTasks.length, 0);
  const totalHours = processes.reduce((s, p) => s + p.subTasks.reduce((h, t) => h + t.estimatedDuration, 0), 0);
  const completedCount = processes.filter(p => p.status === 'COMPLETED').length;
  const inProgressCount = processes.filter(p => p.status === 'IN_PROGRESS').length;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Tasks',       value: totalTasks,      sub: 'Across all sections',  icon: <Settings className="h-4 w-4 text-muted-foreground" /> },
          { label: 'Estimated Hours',   value: `${totalHours}h`, sub: 'Total duration',       icon: <Clock className="h-4 w-4 text-muted-foreground" /> },
          { label: 'In Progress',       value: inProgressCount,  sub: 'Active processes',     icon: <PlayCircle className="h-4 w-4 text-yellow-600" /> },
          { label: 'Completed',         value: completedCount,   sub: 'Finished processes',   icon: <CheckCircle className="h-4 w-4 text-green-600" /> },
        ].map(({ label, value, sub, icon }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              {icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Process plan */}
      <Card>
        <CardHeader>
          <CardTitle>Manufacturing Process Plan</CardTitle>
          <CardDescription>Add tasks to each section and assign BOM parts</CardDescription>
        </CardHeader>
        <CardContent>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1">
              <Label htmlFor="search">Search Processes</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search by process name or responsible person..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="w-full sm:w-48">
              <Label>Filter by Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger><SelectValue placeholder="All Statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="PLANNED">Planned</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="BLOCKED">Blocked</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Section cards */}
          <div className="space-y-4">
            {filtered.map(section => {
              const isExpanded = !collapsedIds.has(section.id);
              const bomCount = section.subTasks.reduce((s, t) => s + t.bomRequirements.length, 0);

              return (
                <Card key={section.id} className={`border-l-4 ${sectionBorder[section.name] ?? 'border-l-gray-400'}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setCollapsedIds(prev => {
                            const next = new Set(prev);
                            next.has(section.id) ? next.delete(section.id) : next.add(section.id);
                            return next;
                          })}
                          className="p-0 h-auto"
                        >
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </Button>

                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${sectionNumBg[section.name] ?? 'bg-gray-500'}`}>
                          {section.sequence}
                        </div>

                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-bold text-base">{section.name}</h3>
                            <span className="text-xs text-muted-foreground">
                              {section.subTasks.length} task{section.subTasks.length !== 1 ? 's' : ''}
                            </span>
                            {bomCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                · {bomCount} BOM part{bomCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            <Badge className={getStatusColor(section.status)} variant="outline">
                              <div className="flex items-center gap-1">
                                {getStatusIcon(section.status)}
                                {section.status}
                              </div>
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{section.description}</p>
                        </div>
                      </div>

                      <Button
                        size="sm" variant="outline"
                        onClick={() => openAddSubTask(section.id)}
                        className="flex items-center gap-1 shrink-0"
                      >
                        <Plus className="h-3 w-3" />
                        Add Sub-Task
                      </Button>
                    </div>
                  </CardHeader>

                  <Collapsible open={isExpanded}>
                    <CollapsibleContent>
                      <CardContent className="pt-0 space-y-4">
                        {processesLoading ? (
                          <div className="text-center py-6 text-muted-foreground text-sm">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-2" />
                            Loading tasks…
                          </div>
                        ) : section.subTasks.length === 0 ? (
                          <div className="text-center py-6 border-2 border-dashed rounded-lg text-muted-foreground">
                            <Users className="h-8 w-8 mx-auto mb-2 opacity-40" />
                            <p className="text-sm">No tasks yet — click <strong>Add Sub-Task</strong> to create one</p>
                          </div>
                        ) : (
                          <div className="grid gap-2">
                            {section.subTasks.map(task => (
                              <div key={task.id} className="p-3 bg-muted/30 rounded-lg space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    {getStatusIcon(task.status)}
                                    <Badge className={getStatusColor(task.status)} variant="outline">
                                      {task.status}
                                    </Badge>
                                    <div>
                                      <div className="font-medium text-sm">{task.name}</div>
                                      {task.description && (
                                        <div className="text-xs text-muted-foreground">{task.description}</div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-4 text-sm shrink-0">
                                    {task.operatorName && (
                                      <div className="text-center">
                                        <div className="text-muted-foreground text-xs">Operator</div>
                                        <div className="font-medium">{task.operatorName}</div>
                                      </div>
                                    )}
                                    <div className="text-center">
                                      <div className="text-muted-foreground text-xs">Duration</div>
                                      <div className="font-medium">{task.estimatedDuration}h</div>
                                    </div>
                                    <Button size="sm" variant="ghost" onClick={() => openEditSubTask(task)}>
                                      <Edit className="h-3 w-3" />
                                    </Button>
                                    <Button
                                      size="sm" variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setConfirmDeleteId(task.id)}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>

                                {task.bomRequirements.length > 0 && (
                                  <div className="border-t pt-2">
                                    <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                                      <Package className="h-3 w-3" /> BOM Parts ({task.bomRequirements.length})
                                    </p>
                                    <div className="grid gap-1">
                                      {task.bomRequirements.map(bp => (
                                        <div key={bp.id} className="flex items-center justify-between text-xs bg-background p-2 rounded border">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono">{bp.partNumber}</span>
                                            <span className="text-muted-foreground">{bp.partName}</span>
                                          </div>
                                          <span className="text-muted-foreground">Req: {bp.requiredQuantity}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Add Sub-Task Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!showNewSubTask} onOpenChange={open => !open && setShowNewSubTask(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Sub-Task</DialogTitle>
            <DialogDescription>
              {showNewSubTask && (() => {
                const p = processes.find(x => x.id === showNewSubTask);
                return p ? `Section: ${p.name}` : '';
              })()}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Task details */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Task Name *</Label>
                  <Input
                    placeholder="e.g. Inspect Steel Plate"
                    value={newSubTaskForm.name}
                    onChange={e => setNewSubTaskForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Operator Name</Label>
                  <Input
                    placeholder="e.g. Bob Smith"
                    value={newSubTaskForm.operatorName}
                    onChange={e => setNewSubTaskForm(f => ({ ...f, operatorName: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea
                  placeholder="Describe what this task involves"
                  rows={2}
                  value={newSubTaskForm.description}
                  onChange={e => setNewSubTaskForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Duration (hours)</Label>
                  <Input
                    type="number" min={0.5} step={0.5}
                    value={newSubTaskForm.estimatedDuration}
                    onChange={e => setNewSubTaskForm(f => ({ ...f, estimatedDuration: parseFloat(e.target.value) || 1 }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea
                  placeholder="Additional instructions"
                  rows={2}
                  value={newSubTaskForm.notes}
                  onChange={e => setNewSubTaskForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            {/* BOM part selection */}
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">Select BOM Parts for this Task</span>
              </div>

              {(lotBomItems as any[]).length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg">
                  <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  No BOM parts available for this lot
                </div>
              ) : (
                <div className="space-y-2">
                  {(lotBomItems as any[]).map((item: any) => {
                    const sel = selectedBOM[item.id];
                    return (
                      <div
                        key={item.id}
                        className={`border rounded-lg p-3 transition-colors ${sel?.selected ? 'border-primary bg-primary/5' : 'border-border'}`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            id={`bom-${item.id}`}
                            checked={!!sel?.selected}
                            onChange={e => setSelectedBOM(prev => ({
                              ...prev,
                              [item.id]: { quantity: item.quantity || 1, ...prev[item.id], selected: e.target.checked },
                            }))}
                            className="w-4 h-4 accent-primary"
                          />
                          <Label htmlFor={`bom-${item.id}`} className="flex-1 cursor-pointer">
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="font-mono font-medium text-sm">{item.part_number}</span>
                                <span className="ml-2 text-muted-foreground text-sm">{item.name}</span>
                              </div>
                              <span className="text-xs text-muted-foreground">{item.unit || 'pcs'}</span>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">BOM qty: {item.quantity}</div>
                          </Label>
                        </div>

                        {sel?.selected && (
                          <div className="mt-2 ml-7 flex items-center gap-3">
                            <Label className="text-xs text-muted-foreground shrink-0">Qty for this task:</Label>
                            <Input
                              type="number" min={1}
                              value={sel.quantity ?? item.quantity ?? 1}
                              onChange={e => setSelectedBOM(prev => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], quantity: parseInt(e.target.value) || 1 },
                              }))}
                              className="h-7 w-24 text-sm"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewSubTask(null)}>Cancel</Button>
            <Button
              type="button"
              onClick={handleCreateSubTask}
              disabled={!newSubTaskForm.name.trim() || createSubtaskMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              {createSubtaskMutation.isPending ? 'Saving…' : 'Create Sub-Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Delete Confirmation Dialog ──────────────────────────────────────── */}
      <Dialog open={!!confirmDeleteId} onOpenChange={open => !open && setConfirmDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Sub-Task</DialogTitle>
            <DialogDescription>This cannot be undone. The sub-task will be permanently removed.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSubTask}
              disabled={deleteSubtaskMutation.isPending}
            >
              {deleteSubtaskMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Sub-Task Dialog ────────────────────────────────────────────── */}
      <Dialog open={!!editingSubTask} onOpenChange={open => !open && setEditingSubTask(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Sub-Task</DialogTitle>
            <DialogDescription>Update sub-task details</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Task Name *</Label>
                <Input
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Operator Name</Label>
                <Input
                  value={editForm.operatorName}
                  onChange={e => setEditForm(f => ({ ...f, operatorName: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={editForm.description}
                onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Duration (hours)</Label>
                <Input
                  type="number" min={0.5} step={0.5}
                  value={editForm.estimatedDuration}
                  onChange={e => setEditForm(f => ({ ...f, estimatedDuration: parseFloat(e.target.value) || 1 }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v as SubTask['status'] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="COMPLETED">Completed</SelectItem>
                    <SelectItem value="BLOCKED">Blocked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={editForm.notes}
                onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSubTask(null)}>Cancel</Button>
            <Button
              type="button"
              onClick={handleUpdateSubTask}
              disabled={!editForm.name.trim() || updateSubtaskMutation.isPending}
            >
              {updateSubtaskMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
