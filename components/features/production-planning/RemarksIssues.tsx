'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { RemarksApi } from '@/lib/api/remarks';
import { CommentsApi } from '@/lib/api/comments';
import { productionPlanningApi } from '@/lib/api/production-planning';
import { toast } from 'sonner';
import {
  RemarkType,
  RemarkPriority,
  RemarkStatus,
  RemarkScope,
  getRemarkTypeColor,
  getRemarkPriorityColor,
  getRemarkStatusColor,
  REMARK_TYPE_OPTIONS,
  REMARK_PRIORITY_OPTIONS,
  REMARK_SCOPE_OPTIONS
} from '@/types/remarks';
import type { Remark } from '@/lib/api/remarks';
import {
  MessageSquare,
  AlertTriangle,
  Clock,
  CheckCircle,
  Search,
  Plus,
  Edit,
  Trash2,
  Calendar,
  User,
  Flag,
  Package,
  Lightbulb
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProcessOption {
  id: string;
  name: string;
  description?: string;
  status: string;
  subtasks?: SubtaskOption[];
}

interface BomPartRequirement {
  id: string;
  bom_item_id: string;
  required_quantity: number;
  unit: string;
  requirement_status: string;
  bom_item?: {
    id: string;
    part_number: string;
    name: string;
    description?: string;
  };
}

interface SubtaskOption {
  id: string;
  name: string;
  description?: string;
  status: string;
  sequence: number;
  assignedOperator?: string;
  operatorName?: string;
  plannedStartDate?: string;
  plannedEndDate?: string;
  bomRequirements?: BomPartRequirement[];
}

interface RemarksIssuesProps {
  lotId: string;
}

// Helper function to safely format dates
const formatDate = (dateString: string | null | undefined, options: { time?: boolean } = {}) => {
  if (!dateString) return 'Unknown date';
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    return options.time ? date.toLocaleString() : date.toLocaleDateString();
  } catch (error) {
    return 'Invalid date';
  }
};

// Helper function to show relative time (e.g., "2 hours ago", "3 days ago")
const getTimeAgo = (dateString: string | null | undefined): string => {
  if (!dateString) {
    return 'Unknown time';
  }
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);
    
    if (diffSeconds < 60) {
      return diffSeconds === 1 ? '1 second ago' : `${diffSeconds} seconds ago`;
    } else if (diffMinutes < 60) {
      return diffMinutes === 1 ? '1 minute ago' : `${diffMinutes} minutes ago`;
    } else if (diffHours < 24) {
      return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
    } else if (diffDays < 7) {
      return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
    } else if (diffWeeks < 4) {
      return diffWeeks === 1 ? '1 week ago' : `${diffWeeks} weeks ago`;
    } else if (diffMonths < 12) {
      return diffMonths === 1 ? '1 month ago' : `${diffMonths} months ago`;
    } else {
      return diffYears === 1 ? '1 year ago' : `${diffYears} years ago`;
    }
  } catch (error) {
    return 'Unknown time';
  }
};

export const RemarksIssues = ({ lotId }: RemarksIssuesProps) => {
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showNewRemark, setShowNewRemark] = useState(false);
  const [selectedRemark, setSelectedRemark] = useState<Remark | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [loadingComments, setLoadingComments] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [formData, setFormData] = useState({
    type: '',
    priority: '',
    appliesTo: '',
    processId: '',
    subtaskId: '',
    bomPartId: '',
    assignedTo: '',
    title: '',
    description: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [processes, setProcesses] = useState<ProcessOption[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [selectedProcess, setSelectedProcess] = useState<ProcessOption | null>(null);
  const [selectedSubtask, setSelectedSubtask] = useState<SubtaskOption | null>(null);
  
  // State to trigger re-render for relative time updates
  const [, setTimeUpdateTrigger] = useState(0);

  // Load comment count for a single remark
  const loadCommentCount = async (remarkId: string) => {
    if (commentCounts[remarkId] !== undefined) return; // Already loaded

    try {
      const commentsData = await CommentsApi.getCommentsByRemark(remarkId);
      setCommentCounts(prev => ({
        ...prev,
        [remarkId]: commentsData?.length || 0
      }));
    } catch (error) {
      setCommentCounts(prev => ({
        ...prev,
        [remarkId]: 0
      }));
    }
  };

  useEffect(() => {
    const fetchRemarksData = async () => {
      try {
        setLoading(true);
        const data = await RemarksApi.getRemarksByLot(lotId);
        const remarksArray = Array.isArray(data) ? data : [];
        setRemarks(remarksArray);
      } catch (error) {
        // Error fetching remarks data
      } finally {
        setLoading(false);
      }
    };

    fetchRemarksData();
  }, [lotId]);

  // Update relative time display every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeUpdateTrigger(prev => prev + 1);
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  // Fetch processes when form is opened and 'Specific Process' might be selected
  const fetchProcesses = async () => {
    if (processes.length > 0) return; // Already loaded

    try {
      setLoadingProcesses(true);

      // Get processes with subtasks and their BOM requirements
      const response = await productionPlanningApi.getProcessesByLot(lotId, false);
      
      // Also get selected BOM items from the lot
      let selectedBomItems = [];
      try {
        const lotResponse = await productionPlanningApi.getProductionLotById(lotId);
        selectedBomItems = (lotResponse as any)?.selectedBomItems || [];
      } catch (bomError) {
        selectedBomItems = [];
      }
      

      const processData = (response as any)?.data || response || [];

      if (!Array.isArray(processData)) {
        throw new Error('Invalid response format - expected array');
      }

      const mappedProcesses: ProcessOption[] = await Promise.all(processData.map(async (process: any) => {
        // Handle different possible subtask field names
        const rawSubtasks = process.subtasks || process.sub_tasks || process.subTasks || [];

        const mappedSubtasks = await Promise.all(rawSubtasks.map(async (subtask: any) => {
          // Get all BOM requirements for this subtask
          const allBomRequirements = subtask.bom_requirements || subtask.bomRequirements || [];
          
          
          let bomRequirements = [];
          
          if (selectedBomItems.length > 0) {
            // If we have selected BOM items, filter to only show those
            bomRequirements = allBomRequirements
              .filter((req: any) => {
                const bomItemId = req.bom_item_id || req.bomItemId;
                const hasMatch = selectedBomItems.some((selectedItem: any) => selectedItem.id === bomItemId);
                return hasMatch;
              })
              .map((req: any) => {
                // Find the selected BOM item data
                const selectedBomItem = selectedBomItems.find((item: any) => item.id === (req.bom_item_id || req.bomItemId));
                
                return {
                  id: req.id,
                  bom_item_id: req.bom_item_id || req.bomItemId,
                  required_quantity: req.required_quantity || req.requiredQuantity || 0,
                  unit: req.unit || 'pcs',
                  requirement_status: req.requirement_status || req.requirementStatus || 'PENDING',
                  bom_item: selectedBomItem ? {
                    id: selectedBomItem.id,
                    part_number: selectedBomItem.partNumber || selectedBomItem.part_number || 'UNKNOWN',
                    name: selectedBomItem.name || selectedBomItem.title || 'Unknown Part',
                    description: selectedBomItem.description || selectedBomItem.details || ''
                  } : null
                };
              });
          } else {
            // Fallback: Show all BOM requirements if no selected items
            bomRequirements = await Promise.all(allBomRequirements.map(async (req: any) => {
              let bomItem = req.bom_item || req.bomItem || req.bom_items || {};
              
              // If no BOM item data but we have an ID, try to fetch it
              if ((!bomItem || Object.keys(bomItem).length === 0) && (req.bom_item_id || req.bomItemId)) {
                try {
                  const bomItemId = req.bom_item_id || req.bomItemId;
                  
                  // Try multiple API endpoints to find BOM item data
                  let fetchedBomItem = null;
                  
                  // Try 1: /api/bom-items/{id}
                  try {
                    const response1 = await fetch(`/api/bom-items/${bomItemId}`);
                    if (response1.ok) {
                      fetchedBomItem = await response1.json();
                    }
                  } catch (e) { /* API call failed */ }
                  
                  // Try 2: /api/boms/items/{id} 
                  if (!fetchedBomItem) {
                    try {
                      const response2 = await fetch(`/api/boms/items/${bomItemId}`);
                      if (response2.ok) {
                        fetchedBomItem = await response2.json();
                      }
                    } catch (e) { /* API call failed */ }
                  }
                  
                  // Try 3: Use apiClient (from the lib)
                  if (!fetchedBomItem) {
                    try {
                      const { apiClient } = await import('@/lib/api/client');
                      const response3 = await apiClient.get(`/bom-items/${bomItemId}`);
                      fetchedBomItem = (response3 as any).data || response3;
                    } catch (e) { /* API call failed */ }
                  }
                  
                  if (fetchedBomItem) {
                    bomItem = fetchedBomItem.data || fetchedBomItem;
                  }
                } catch (fetchError) {
                  // Error fetching BOM item
                }
              }
              
              return {
                id: req.id,
                bom_item_id: req.bom_item_id || req.bomItemId,
                required_quantity: req.required_quantity || req.requiredQuantity || 0,
                unit: req.unit || 'pcs',
                requirement_status: req.requirement_status || req.requirementStatus || 'PENDING',
                bom_item: bomItem && Object.keys(bomItem).length > 0 ? {
                  id: bomItem.id,
                  part_number: bomItem.part_number || bomItem.partNumber || bomItem.part_code || 'UNKNOWN',
                  name: bomItem.name || bomItem.title || 'Unknown Part',
                  description: bomItem.description || bomItem.details || ''
                } : null
              };
            }));
          }

          return {
            id: subtask.id,
            name: subtask.taskName || subtask.name || subtask.task_name || 'Unnamed Subtask',
            description: subtask.description,
            status: subtask.status,
            sequence: subtask.taskSequence || subtask.sequence || subtask.task_sequence || 0,
            assignedOperator: subtask.assigned_operator || subtask.assignedOperator,
            operatorName: subtask.operator_name || subtask.operatorName,
            plannedStartDate: subtask.planned_start_date || subtask.plannedStartDate,
            plannedEndDate: subtask.planned_end_date || subtask.plannedEndDate,
            bomRequirements
          };
        }));

        // Create unique process name if original name is generic
        const rawName = process.processName || process.name || process.process_name || process.sectionName;
        const isGenericName = rawName === 'Process' || rawName === 'Inspection' || rawName === 'Raw Material' || rawName === 'Packing';
        const uniqueName = isGenericName
          ? `${rawName} (${process.id?.slice(-8) || 'ID-Unknown'})`
          : rawName || `Process ${process.id?.slice(-4) || 'Unknown'}`;

        return {
          id: process.id,
          name: uniqueName,
          description: process.description || `${process.sectionName || rawName || 'Process'} operations - ${mappedSubtasks.length} subtask(s)`,
          status: process.status || 'UNKNOWN',
          subtasks: mappedSubtasks
        };
      }));

      setProcesses(mappedProcesses);


    } catch (error) {
      // Error fetching processes
    } finally {
      setLoadingProcesses(false);
    }
  };

  // Handle applies to change
  const handleAppliesToChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      appliesTo: value,
      processId: '', // Reset process selection
      subtaskId: '', // Reset subtask selection
      bomPartId: ''  // Reset BOM part selection
    }));
    setSelectedProcess(null);
    setSelectedSubtask(null);

    // Fetch processes if process-related scope is selected
    if (value === 'PROCESS' || value === 'SUBTASK' || value === 'BOM_PART') {
      fetchProcesses();
    }
  };

  // Handle process selection
  const handleProcessChange = (processId: string) => {
    const process = processes.find(p => p.id === processId);
    setSelectedProcess(process || null);
    setFormData(prev => ({
      ...prev,
      processId,
      subtaskId: '' // Reset subtask when process changes
    }));
  };

  // Handle subtask selection
  const handleSubtaskChange = (subtaskId: string) => {
    const actualSubtaskId = subtaskId === 'none' ? '' : subtaskId;
    const subtask = selectedProcess?.subtasks?.find(s => s.id === actualSubtaskId);

    setSelectedSubtask(subtask || null);
    setFormData(prev => ({
      ...prev,
      subtaskId: actualSubtaskId,
      bomPartId: '' // Reset BOM part when subtask changes
    }));
  };

  // Handle BOM part selection
  const handleBomPartChange = (bomPartId: string) => {
    // Don't allow selection of the disabled placeholder option
    if (bomPartId === 'none') {
      return;
    }

    setFormData(prev => ({
      ...prev,
      bomPartId: bomPartId
    }));
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'DELAY': return <Clock className="h-4 w-4" />;
      case 'QUALITY': return <CheckCircle className="h-4 w-4" />;
      case 'MATERIAL': return <Package className="h-4 w-4" />;
      case 'SAFETY': return <Flag className="h-4 w-4" />;
      case 'SUGGESTION': return <Lightbulb className="h-4 w-4" />;
      default: return <MessageSquare className="h-4 w-4" />;
    }
  };

  const handleCreateRemark = async () => {
    if (!formData.type || !formData.priority || !formData.appliesTo || !formData.title.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    // Additional validation for process/subtask scopes
    if (formData.appliesTo === 'PROCESS' && !formData.processId) {
      return;
    }

    if (formData.appliesTo === 'SUBTASK') {
      if (!formData.processId) {
        return;
      }
      if (!formData.subtaskId || formData.subtaskId === 'none') {
        return;
      }
    }

    if (formData.appliesTo === 'BOM_PART') {
      if (!formData.processId) {
        return;
      }
      if (!formData.subtaskId || formData.subtaskId === 'none') {
        return;
      }
      if (!formData.bomPartId || formData.bomPartId === 'none' || formData.bomPartId === '') {
        return;
      }
    }

    try {
      setSubmitting(true);
      const remarkData: any = {
        lotId,
        title: formData.title.trim(),
        remarkType: formData.type as RemarkType,
        priority: formData.priority as RemarkPriority,
        appliesTo: formData.appliesTo as RemarkScope,
      };

      // Add process/subtask IDs based on scope
      if (formData.appliesTo === 'PROCESS' && formData.processId) {
        remarkData.processId = formData.processId;
      }

      if (formData.appliesTo === 'SUBTASK') {
        if (formData.processId) {
          remarkData.processId = formData.processId;
        }
        if (formData.subtaskId && formData.subtaskId !== 'none') {
          remarkData.subtaskId = formData.subtaskId;
        }
      }

      if (formData.appliesTo === 'BOM_PART') {
        if (formData.processId) {
          remarkData.processId = formData.processId;
        }
        if (formData.subtaskId && formData.subtaskId !== 'none') {
          remarkData.subtaskId = formData.subtaskId;
        }
        if (formData.bomPartId && formData.bomPartId !== 'none') {
          remarkData.bomPartId = formData.bomPartId;
        }
      }

      // Only add optional fields if they have values
      if (formData.description && formData.description.trim()) {
        remarkData.description = formData.description.trim();
      }

      if (formData.assignedTo && formData.assignedTo.trim()) {
        remarkData.assignedTo = formData.assignedTo.trim();
      }

      // Set context reference based on selected process/subtask
      if (formData.appliesTo === 'PROCESS' && selectedProcess) {
        remarkData.contextReference = selectedProcess.name;
      } else if (formData.appliesTo === 'SUBTASK') {
        if (selectedProcess && formData.subtaskId && formData.subtaskId !== 'none') {
          const selectedSubtask = selectedProcess.subtasks?.find(st => st.id === formData.subtaskId);
          if (selectedSubtask) {
            remarkData.contextReference = `${selectedProcess.name} > ${selectedSubtask.name}`;
          }
        } else if (selectedProcess) {
          // If only process is selected for subtask scope
          remarkData.contextReference = `${selectedProcess.name} (Process level)`;
        }
      } else if (formData.appliesTo === 'BOM_PART') {
        if (selectedProcess && selectedSubtask && formData.bomPartId && formData.bomPartId !== 'none') {
          const bomPart = selectedSubtask.bomRequirements?.find(req => req.id === formData.bomPartId);
          if (bomPart?.bom_item) {
            remarkData.contextReference = `${selectedProcess.name} > ${selectedSubtask.name} > ${bomPart.bom_item.part_number}`;
          }
        }
      }

      await RemarksApi.createRemark(remarkData);
      // Refresh the remarks list after creation
      const updatedRemarks = await RemarksApi.getRemarksByLot(lotId);
      setRemarks(Array.isArray(updatedRemarks) ? updatedRemarks : []);
      setShowNewRemark(false);
      setFormData({
        type: '',
        priority: '',
        appliesTo: '',
        processId: '',
        subtaskId: '',
        bomPartId: '',
        assignedTo: '',
        title: '',
        description: ''
      });
      setSelectedProcess(null);
      setSelectedSubtask(null);
      setShowNewRemark(false);
    } catch (error) {
      // Error creating remark
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRemark = async (remarkId: string) => {
    if (!confirm('Are you sure you want to delete this remark?')) return;

    try {
      await RemarksApi.deleteRemark(remarkId);
      // Remove from state immediately for better UX
      setRemarks(prev => prev.filter(r => r.id !== remarkId));
    } catch (error) {
      // Error deleting remark
    }
  };

  const handleEditRemark = (remark: Remark) => {
    // TODO: Implement edit functionality
    // TODO: Implement edit functionality
  };


  // Comment handling functions
  const loadComments = async (remarkId: string) => {
    try {
      setLoadingComments(true);
      const commentsData = await CommentsApi.getCommentsByRemark(remarkId);
      setComments(commentsData || []);
      // Update comment count for this remark
      setCommentCounts(prev => ({
        ...prev,
        [remarkId]: commentsData?.length || 0
      }));
    } catch (error) {
      setComments([]);
      setCommentCounts(prev => ({
        ...prev,
        [remarkId]: 0
      }));
    } finally {
      setLoadingComments(false);
    }
  };

  const handlePostComment = async () => {
    if (!newComment.trim() || !selectedRemark) return;

    try {
      setSubmittingComment(true);
      await CommentsApi.createComment(selectedRemark.id, {
        commentText: newComment.trim(),
        remarkId: selectedRemark.id
      });

      setNewComment('');
      // Reload comments
      await loadComments(selectedRemark.id);
    } catch (error) {
      // Error posting comment
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) return;

    try {
      await CommentsApi.deleteComment(commentId);
      // Reload comments
      if (selectedRemark) {
        await loadComments(selectedRemark.id);
      }
    } catch (error) {
      // Error deleting comment
    }
  };

  // Load comments when a remark is selected
  useEffect(() => {
    if (selectedRemark) {
      loadComments(selectedRemark.id);
    }
  }, [selectedRemark]);

  const filteredRemarks = (remarks || []).filter(remark => {
    if (!remark) return false;
    const matchesSearch = (remark.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (remark.description || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || remark.remarkType === filterType;
    const matchesLevel = filterLevel === 'all' || filterLevel === 'all'; // Simplify for now since appliesTo doesn't exist
    const matchesStatus = filterStatus === 'all' || remark.status === filterStatus;
    return matchesSearch && matchesType && matchesLevel && matchesStatus;
  });

  // Calculate statistics
  const totalRemarks = (remarks || []).length;
  const openRemarks = (remarks || []).filter(r => r && r.status === 'OPEN').length;
  const criticalRemarks = (remarks || []).filter(r => r && r.priority === 'CRITICAL').length;
  const resolvedRemarks = (remarks || []).filter(r => r && r.status === 'RESOLVED').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Remarks</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRemarks}</div>
            <p className="text-xs text-muted-foreground">
              All issues and remarks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Issues</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{openRemarks}</div>
            <p className="text-xs text-muted-foreground">
              Require attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Issues</CardTitle>
            <Flag className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{criticalRemarks}</div>
            <p className="text-xs text-muted-foreground">
              High priority items
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{resolvedRemarks}</div>
            <p className="text-xs text-muted-foreground">
              Completed issues
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Remarks and Issues */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Remarks & Issues</CardTitle>
              <CardDescription>
                Track and manage issues, delays, and suggestions for this production lot
              </CardDescription>
            </div>
            <Dialog open={showNewRemark} onOpenChange={setShowNewRemark}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Remark
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Remark</DialogTitle>
                  <DialogDescription>
                    Record an issue, suggestion, or important note
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="type">Type</Label>
                      <Select value={formData.type} onValueChange={(value) => setFormData(prev => ({ ...prev, type: value }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          {REMARK_TYPE_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="priority">Priority</Label>
                      <Select value={formData.priority} onValueChange={(value) => setFormData(prev => ({ ...prev, priority: value }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                        <SelectContent>
                          {REMARK_PRIORITY_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="level">Applies To</Label>
                      <Select value={formData.appliesTo} onValueChange={handleAppliesToChange}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select scope" />
                        </SelectTrigger>
                        <SelectContent>
                          {REMARK_SCOPE_OPTIONS.map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="assignedTo">Assign To (Name)</Label>
                      <Input
                        id="assignedTo"
                        placeholder="Enter person's name (optional)"
                        value={formData.assignedTo}
                        onChange={(e) => setFormData(prev => ({ ...prev, assignedTo: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Process Selection - Show when 'PROCESS', 'SUBTASK' or 'BOM_PART' is selected */}
                  {(formData.appliesTo === 'PROCESS' || formData.appliesTo === 'SUBTASK' || formData.appliesTo === 'BOM_PART') && (
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <Label htmlFor="process">
                          Select Process {(formData.appliesTo === 'PROCESS' || formData.appliesTo === 'SUBTASK' || formData.appliesTo === 'BOM_PART') ? '(Required)' : ''}
                        </Label>
                        <Select
                          value={formData.processId}
                          onValueChange={handleProcessChange}
                          disabled={loadingProcesses}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={loadingProcesses ? "Loading processes..." : "Select a process"} />
                          </SelectTrigger>
                          <SelectContent>
                            {processes.length === 0 && !loadingProcesses && (
                              <div className="p-2 text-sm text-muted-foreground">
                                No processes found for this lot
                              </div>
                            )}
                            {processes.map(process => (
                              <SelectItem key={process.id} value={process.id}>
                                <div className="flex flex-col items-start">
                                  <span className="font-medium">{process.name}</span>
                                  {process.description && (
                                    <span className="text-xs text-muted-foreground">{process.description}</span>
                                  )}
                                  <div className="flex gap-2 text-xs text-muted-foreground">
                                    <span>Status: {process.status}</span>
                                    <span>• {process.subtasks?.length || 0} subtasks</span>
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {processes.length === 0 && !loadingProcesses && (
                          <p className="text-xs text-yellow-600 mt-1">
                            No processes available. Please ensure processes have been created for this production lot.
                          </p>
                        )}
                      </div>

                      {/* Subtask Selection - Show when process is selected and has subtasks */}
                      {selectedProcess && selectedProcess.subtasks && selectedProcess.subtasks.length > 0 && (
                        <div>
                          <Label htmlFor="subtask">
                            Select Subtask {(formData.appliesTo === 'SUBTASK' || formData.appliesTo === 'BOM_PART') ? '(Required)' : '(Optional)'}
                          </Label>
                          <Select
                            value={formData.subtaskId}
                            onValueChange={handleSubtaskChange}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={
                                (formData.appliesTo === 'SUBTASK' || formData.appliesTo === 'BOM_PART')
                                  ? "Select a subtask"
                                  : "Select a subtask (optional)"
                              } />
                            </SelectTrigger>
                            <SelectContent>
                              {(formData.appliesTo !== 'SUBTASK' && formData.appliesTo !== 'BOM_PART') && (
                                <SelectItem value="none">
                                  <span className="text-muted-foreground">No specific subtask</span>
                                </SelectItem>
                              )}
                              {selectedProcess.subtasks
                                .sort((a, b) => a.sequence - b.sequence)
                                .map(subtask => (
                                  <SelectItem key={subtask.id} value={subtask.id}>
                                    <div className="flex flex-col items-start">
                                      <span className="font-medium">{subtask.name}</span>
                                      {subtask.description && (
                                        <span className="text-xs text-muted-foreground">{subtask.description}</span>
                                      )}
                                      <div className="flex gap-2 text-xs text-muted-foreground">
                                        <span>Seq: {subtask.sequence}</span>
                                        <span>Status: {subtask.status}</span>
                                      </div>
                                    </div>
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>

                          {/* Note about subtask selection */}
                          <p className="text-xs text-muted-foreground mt-1">
                            {(formData.appliesTo === 'SUBTASK' || formData.appliesTo === 'BOM_PART')
                              ? 'Select a specific subtask for granular remark targeting.'
                              : 'Select a specific subtask for more granular remark targeting, or leave blank for general process remarks.'
                            }
                          </p>
                        </div>
                      )}

                      {/* Show message if no subtasks available but subtask/bompart scope is selected */}
                      {(formData.appliesTo === 'SUBTASK' || formData.appliesTo === 'BOM_PART') && selectedProcess &&
                        (!selectedProcess.subtasks || selectedProcess.subtasks.length === 0) && (
                          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <p className="text-sm text-yellow-800">
                              <strong>No subtasks available</strong> for the selected process "{selectedProcess.name}".
                              You may want to change the scope to 'Specific Process' instead, or create subtasks for this process first.
                            </p>
                          </div>
                        )}

                      {/* BOM Part Selection - Show when 'BOM_PART' is selected and subtask has BOM parts */}
                      {formData.appliesTo === 'BOM_PART' && selectedSubtask &&
                        selectedSubtask.bomRequirements && selectedSubtask.bomRequirements.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Label htmlFor="bompart">Select BOM Part (Required)</Label>
                              <Badge variant="outline" className="text-xs">
                                {selectedSubtask.bomRequirements.length} parts available
                              </Badge>
                            </div>
                            <Select
                              value={formData.bomPartId}
                              onValueChange={handleBomPartChange}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a BOM part" />
                              </SelectTrigger>
                              <SelectContent>
                                {/* Empty option to ensure manual selection is required */}
                                <SelectItem value="none" disabled>
                                  <span className="text-muted-foreground">Select a BOM part below...</span>
                                </SelectItem>

                                {selectedSubtask.bomRequirements.map(requirement => {
                                  
                                  return (
                                  <SelectItem key={requirement.id} value={requirement.id}>
                                    <div className="flex flex-col items-start w-full">
                                      <div className="flex items-center justify-between w-full mb-1">
                                        <div className="flex flex-col">
                                          <span className="font-medium">
                                            {requirement.bom_item?.name && requirement.bom_item.name !== 'Unknown Part'
                                              ? requirement.bom_item.name
                                              : requirement.bom_item?.part_number && requirement.bom_item.part_number !== 'UNKNOWN'
                                              ? requirement.bom_item.part_number
                                              : `Part #${requirement.id?.slice(-4) || 'XXXX'}`}
                                          </span>
                                          {requirement.bom_item?.part_number && requirement.bom_item.part_number !== 'UNKNOWN' && 
                                           requirement.bom_item?.name && requirement.bom_item.name !== 'Unknown Part' && (
                                            <span className="text-xs text-muted-foreground">#{requirement.bom_item.part_number}</span>
                                          )}
                                        </div>
                                        {requirement.requirement_status && (
                                          <Badge
                                            variant={requirement.requirement_status === 'AVAILABLE' ? 'default' : 'secondary'}
                                            className="text-xs py-0 px-1"
                                          >
                                            {requirement.requirement_status}
                                          </Badge>
                                        )}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        Required: {requirement.required_quantity > 0 ? requirement.required_quantity : '?'} {requirement.unit}
                                      </div>
                                      {requirement.bom_item?.description && requirement.bom_item.description !== 'No BOM item data available' && (
                                        <div className="text-xs text-muted-foreground italic">
                                          {requirement.bom_item.description}
                                        </div>
                                      )}
                                    </div>
                                  </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>

                            <p className="text-xs text-muted-foreground mt-1">
                              Select a specific BOM part for very granular remark targeting about material issues, availability, or quality.
                            </p>
                          </div>
                        )}

                      {/* Show message if no BOM parts available but BOM_PART scope is selected */}
                      {formData.appliesTo === 'BOM_PART' && selectedSubtask &&
                        (!selectedSubtask.bomRequirements || selectedSubtask.bomRequirements.length === 0) && (
                          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <p className="text-sm text-yellow-800">
                              <strong>No BOM parts available</strong> for the selected subtask "{selectedSubtask.name}".
                              This might be because no BOM items were selected for this lot, or this subtask doesn't require specific parts.
                              You may want to change the scope to 'Specific Subtask' instead.
                            </p>
                          </div>
                        )}

                    </div>
                  )}

                  <div>
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      placeholder="Brief description of the issue"
                      value={formData.title}
                      onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Detailed description of the issue, impact, and any immediate actions taken"
                      rows={4}
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    onClick={handleCreateRemark}
                    disabled={submitting}
                  >
                    {submitting ? 'Creating...' : 'Create Remark'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-col lg:flex-row gap-4 mb-6">
            <div className="flex-1">
              <Label htmlFor="search">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Search remarks and issues..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 lg:w-96">
              <div>
                <Label>Type</Label>
                <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="DELAY">Delays</SelectItem>
                    <SelectItem value="QUALITY">Quality</SelectItem>
                    <SelectItem value="MATERIAL">Material</SelectItem>
                    <SelectItem value="SAFETY">Safety</SelectItem>
                    <SelectItem value="SUGGESTION">Suggestions</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Level</Label>
                <Select value={filterLevel} onValueChange={setFilterLevel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Levels</SelectItem>
                    <SelectItem value="LOT">Lot</SelectItem>
                    <SelectItem value="PROCESS">Process</SelectItem>
                    <SelectItem value="SUBTASK">Sub-task</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Remarks List */}
          <div className="space-y-4">
            {filteredRemarks.map((remark) => (
              <Card key={remark.id} className="border-l-4 border-l-orange-500">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge className={getRemarkTypeColor(remark.remarkType as RemarkType)} variant="outline">
                          {getTypeIcon(remark.remarkType)}
                          {remark.remarkType}
                        </Badge>
                        <Badge className={getRemarkPriorityColor(remark.priority as RemarkPriority)}>
                          {remark.priority}
                        </Badge>
                        <Badge className={getRemarkStatusColor(remark.status as RemarkStatus)} variant="outline">
                          {remark.status}
                        </Badge>
                      </div>
                      <h3 className="font-semibold">{remark.title}</h3>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium">General:</span> {remark.bomPartId || 'General'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedRemark(remark)}
                        className="flex-shrink-0"
                      >
                        View Details
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleEditRemark(remark)}
                        className="flex-shrink-0"
                        title="Edit remark"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteRemark(remark.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 flex-shrink-0"
                        title="Delete remark"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm mb-4">{remark.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        Created by {remark.createdBy || 'User'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        <span title={remark.reportedDate ? formatDate(remark.reportedDate, { time: true }) : 'Unknown time'}>
                          {getTimeAgo(remark.reportedDate)}
                        </span>
                      </div>
                      {remark.assignedTo && (
                        <div className="flex items-center gap-2">
                          <Flag className="h-3 w-3" />
                          Assigned to {remark.assignedTo}
                        </div>
                      )}
                    </div>
                    <div
                      className="flex items-center gap-2"
                      onMouseEnter={() => loadCommentCount(remark.id)}
                    >
                      <MessageSquare className="h-3 w-3" />
                      {commentCounts[remark.id] !== undefined ? commentCounts[remark.id] : '...'} comments
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredRemarks.length === 0 && (
            <div className="text-center py-8">
              <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <div className="text-lg font-medium mb-2">No remarks found</div>
              <div className="text-muted-foreground">
                {searchTerm || filterType !== 'all' || filterLevel !== 'all' || filterStatus !== 'all'
                  ? 'Try adjusting your search or filter criteria'
                  : 'No issues or remarks have been recorded yet'
                }
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remark Details Modal */}
      {selectedRemark && (
        <Dialog open={!!selectedRemark} onOpenChange={() => setSelectedRemark(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {getTypeIcon(selectedRemark.remarkType)}
                {selectedRemark.title}
              </DialogTitle>
              <DialogDescription>
                View and manage remark details, status, and comments
              </DialogDescription>
              <div className="flex items-center gap-2">
                <Badge className={getRemarkTypeColor(selectedRemark.remarkType as RemarkType)} variant="outline">
                  {selectedRemark.remarkType}
                </Badge>
                <Badge className={getRemarkPriorityColor(selectedRemark.priority as RemarkPriority)}>
                  {selectedRemark.priority}
                </Badge>
                <Badge className={getRemarkStatusColor(selectedRemark.status as RemarkStatus)} variant="outline">
                  {selectedRemark.status}
                </Badge>
              </div>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Description</h4>
                <p className="text-sm text-muted-foreground">{selectedRemark.description}</p>
              </div>

              {selectedRemark.resolutionNotes && (
                <div>
                  <h4 className="font-medium mb-2">Resolution</h4>
                  <p className="text-sm text-muted-foreground">{selectedRemark.resolutionNotes}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium">Created by:</span> {selectedRemark.createdBy || 'User'}
                </div>
                <div>
                  <span className="font-medium">Created:</span> {getTimeAgo(selectedRemark.reportedDate)} 
                  <span className="text-muted-foreground text-xs ml-2">({selectedRemark.reportedDate ? formatDate(selectedRemark.reportedDate, { time: true }) : 'Unknown time'})</span>
                </div>
                <div>
                  <span className="font-medium">Applies to:</span> {selectedRemark.bomPartId || 'General'}
                </div>
                {selectedRemark.assignedTo && (
                  <div>
                    <span className="font-medium">Assigned to:</span> {selectedRemark.assignedTo}
                  </div>
                )}
              </div>

              {/* Comments count not available in Remark interface, will show comment count from loaded comments */}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="status">Status</Label>
                  <Select value={selectedRemark.status} onValueChange={(value) => setSelectedRemark({ ...selectedRemark, status: value as any })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="priority">Priority</Label>
                  <Select value={selectedRemark.priority} onValueChange={(value) => setSelectedRemark({ ...selectedRemark, priority: value as any })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* GitHub-style Comments Section */}
              <div className="border-t pt-4">
                <h4 className="font-medium mb-4 flex items-center gap-2">
                  <span>Comments</span>
                  <Badge variant="secondary">{comments.length}</Badge>
                </h4>

                {/* Comments List */}
                {loadingComments ? (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  </div>
                ) : comments.length > 0 ? (
                  <div className="space-y-4 mb-4 max-h-64 overflow-y-auto">
                    {comments.map((comment) => (
                      <div key={comment.id} className="border rounded-lg p-3 bg-muted/50">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-6 w-6">
                              <AvatarFallback>
                                {comment.creator?.name ? comment.creator.name.charAt(0).toUpperCase() : 'U'}
                              </AvatarFallback>
                            </Avatar>
                            <span className="text-sm font-medium">
                              {comment.creator?.name || 'User'}
                            </span>
                            <span className="text-xs text-muted-foreground" title={comment.createdAt ? formatDate(comment.createdAt, { time: true }) : 'Unknown time'}>
                              {getTimeAgo(comment.createdAt)}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteComment(comment.id)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{comment.commentText}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground mb-4">No comments yet.</p>
                )}

                {/* Add New Comment */}
                <div>
                  <Textarea
                    placeholder="Add a comment or update..."
                    rows={3}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="mb-2"
                  />
                  <Button
                    size="sm"
                    onClick={handlePostComment}
                    disabled={!newComment.trim() || submittingComment}
                    className="ml-auto"
                  >
                    {submittingComment ? 'Posting...' : 'Post Comment'}
                  </Button>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedRemark(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};