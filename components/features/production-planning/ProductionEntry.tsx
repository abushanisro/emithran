'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Clock,
  Plus,
  Edit,
  BarChart3,
  Target,
  XCircle
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { productionEntriesApi } from '@/lib/api/production-entries';
import type { CreateProductionEntryRequest } from '@/lib/api/production-entries';

interface ProductionEntry {
  id: string;
  date: string;
  shift: 'MORNING' | 'AFTERNOON' | 'NIGHT';
  processId: string;
  processName: string;
  targetQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  reworkQuantity: number;
  downtimeMinutes: number;
  downtimeReason: string;
  qualityIssues: string;
  operatorNotes: string;
  enteredBy: string;
  enteredAt: string;
}

interface WeeklyEntry {
  week: string;
  targetQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
  efficiency: number;
}

interface ProductionEntryProps {
  lotId?: string;
}

export const ProductionEntry = ({ lotId = '' }: ProductionEntryProps) => {
  const [entries, setEntries] = useState<ProductionEntry[]>([]);
  const [weeklyEntries, setWeeklyEntries] = useState<WeeklyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterProcess, setFilterProcess] = useState<string>('all');
  const [showNewEntry, setShowNewEntry] = useState(false);
  const [showEditEntry, setShowEditEntry] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ProductionEntry | null>(null);
  const [entryType, setEntryType] = useState<'daily' | 'weekly'>('daily');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  interface ProductionEntryFormData {
    lotId: string;
    processId?: string;
    processName: string;
    entryDate: string;
    shift: 'MORNING' | 'AFTERNOON' | 'NIGHT';
    targetQuantity: number;
    producedQuantity: number;
    rejectedQuantity: number;
    reworkQuantity: number;
    downtimeMinutes: number;
    downtimeReason: string;
    qualityIssues: string;
    operatorNotes: string;
  }

  const [formData, setFormData] = useState<ProductionEntryFormData>({
    lotId: lotId,
    entryDate: new Date().toISOString().split('T')[0] || '',
    shift: 'MORNING',
    targetQuantity: 0,
    producedQuantity: 0,
    rejectedQuantity: 0,
    reworkQuantity: 0,
    downtimeMinutes: 0,
    downtimeReason: '',
    qualityIssues: '',
    operatorNotes: '',
    processName: ''
  });

  useEffect(() => {
    const fetchProductionData = async () => {
      if (!lotId) return;

      try {
        setLoading(true);

        // Fetch production entries from API
        const entriesData = await productionEntriesApi.getEntriesByLot(lotId);

        // API client returns data directly
        const entries = Array.isArray(entriesData) ? entriesData : (entriesData as any)?.data || [];

        // Check if entries is an array before mapping
        if (Array.isArray(entries)) {
          console.log('Sample entry structure:', entries[0]);
          setEntries(entries.map(entry => ({
            id: entry.id,
            date: entry.entry_date || entry.date || '',
            shift: (entry.shift as 'MORNING' | 'AFTERNOON' | 'NIGHT') || 'MORNING',
            processId: entry.production_process_id || '',
            processName: entry.production_process?.process_name || 'General Production',
            targetQuantity: entry.planned_quantity || entry.quantity || 0,
            producedQuantity: entry.actual_quantity || entry.quantity || 0,
            rejectedQuantity: entry.rejected_quantity || 0,
            reworkQuantity: entry.rework_quantity || 0,
            downtimeMinutes: Math.floor((entry.downtime_hours || 0) * 60),
            downtimeReason: entry.downtime_reason || '',
            qualityIssues: entry.issues_encountered || '',
            operatorNotes: entry.remarks || entry.notes || '',
            enteredBy: entry.entered_by || '',
            enteredAt: entry.created_at
          })));
        } else {
          setEntries([]);
        }

        // Fetch weekly summary from API
        const weeklyData = await productionEntriesApi.getWeeklySummary(lotId);

        // Check if weeklyData is an array before mapping
        if (Array.isArray(weeklyData)) {
          setWeeklyEntries(weeklyData.map(week => ({
            week: week.week,
            targetQuantity: week.totalPlanned,
            producedQuantity: week.totalActual,
            rejectedQuantity: week.totalRejected,
            efficiency: week.efficiency
          })));
        } else {
          setWeeklyEntries([]);
        }

        setLoading(false);
      } catch (error) {
        console.error('Error fetching production entry data:', error);
        setEntries([]);
        setWeeklyEntries([]);
        setLoading(false);
      }
    };

    fetchProductionData();
  }, [lotId]);

  const refreshData = async () => {
    if (!lotId) return;
    try {
      const entriesData = await productionEntriesApi.getEntriesByLot(lotId);
      const entries = Array.isArray(entriesData) ? entriesData : (entriesData as any)?.data || [];
      if (Array.isArray(entries)) {
        setEntries(entries.map(entry => ({
          id: entry.id,
          date: entry.entry_date || entry.date || '',
          shift: (entry.shift as 'MORNING' | 'AFTERNOON' | 'NIGHT') || 'MORNING',
          processId: entry.production_process_id || '',
          processName: entry.production_process?.process_name || 'General Production',
          targetQuantity: entry.planned_quantity || entry.quantity || 0,
          producedQuantity: entry.actual_quantity || entry.quantity || 0,
          rejectedQuantity: entry.rejected_quantity || 0,
          reworkQuantity: entry.rework_quantity || 0,
          downtimeMinutes: Math.floor((entry.downtime_hours || 0) * 60),
          downtimeReason: entry.downtime_reason || '',
          qualityIssues: entry.issues_encountered || '',
          operatorNotes: entry.remarks || entry.notes || '',
          enteredBy: entry.entered_by || '',
          enteredAt: entry.created_at
        })));
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
    }
  };

  const handleSaveEntry = async () => {
    if (!formData.processName || !formData.entryDate || !formData.shift) {
      return;
    }

    try {
      setSaving(true);

      const entryData: CreateProductionEntryRequest = {
        lot_id: lotId, // This will be extracted for URL path
        productionLotId: lotId,
        // productionProcessId omitted: optional and not selected in this form
        entryDate: formData.entryDate, // Should be in YYYY-MM-DD format
        entryType: 'daily',
        plannedQuantity: Math.floor(Number(formData.targetQuantity) || 0),
        actualQuantity: Math.floor(Number(formData.producedQuantity) || 0),
        rejectedQuantity: Math.floor(Number(formData.rejectedQuantity) || 0),
        reworkQuantity: Math.floor(Number(formData.reworkQuantity) || 0),
        downtimeHours: Number(((formData.downtimeMinutes || 0) / 60).toFixed(2)), // Convert minutes to hours with 2 decimal places
        downtimeReason: formData.downtimeReason || '',
        shift: formData.shift,
        operatorsCount: 1,
        // supervisor omitted: optional and not collected in this form
        remarks: formData.operatorNotes || '',
        issuesEncountered: formData.qualityIssues || ''
      };

      console.log('Sending production entry data:', entryData);

      await productionEntriesApi.createEntry(entryData as any);

      // Refresh data after successful save
      await refreshData();

      // Reset form and close dialog
      setFormData({
        lotId: lotId,
        entryDate: new Date().toISOString().split('T')[0] || '',
        shift: 'MORNING',
        targetQuantity: 0,
        producedQuantity: 0,
        rejectedQuantity: 0,
        reworkQuantity: 0,
        downtimeMinutes: 0,
        downtimeReason: '',
        qualityIssues: '',
        operatorNotes: '',
        processName: ''
      });
      setShowNewEntry(false);

    } catch (error) {
      console.error('Error saving production entry:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleEditEntry = (entry: ProductionEntry) => {
    setEditingEntry(entry);
    setFormData({
      lotId: lotId,
      processId: entry.processId,
      processName: entry.processName,
      entryDate: entry.date,
      shift: entry.shift,
      targetQuantity: entry.targetQuantity,
      producedQuantity: entry.producedQuantity,
      rejectedQuantity: entry.rejectedQuantity,
      reworkQuantity: entry.reworkQuantity,
      downtimeMinutes: entry.downtimeMinutes,
      downtimeReason: entry.downtimeReason,
      qualityIssues: entry.qualityIssues,
      operatorNotes: entry.operatorNotes
    });
    setShowEditEntry(true);
  };

  const handleUpdateEntry = async () => {
    if (!editingEntry || !formData.processName || !formData.entryDate || !formData.shift) {
      return;
    }

    try {
      setSaving(true);

      await productionEntriesApi.updateEntry(editingEntry.id, {
        processName: formData.processName,
        entryDate: formData.entryDate,
        shift: formData.shift,
        targetQuantity: formData.targetQuantity,
        producedQuantity: formData.producedQuantity,
        rejectedQuantity: formData.rejectedQuantity,
        reworkQuantity: formData.reworkQuantity,
        downtimeMinutes: formData.downtimeMinutes,
        downtimeReason: formData.downtimeReason,
        qualityIssues: formData.qualityIssues,
        operatorNotes: formData.operatorNotes
      });

      // Refresh data after successful update
      await refreshData();

      // Reset form and close dialog
      setFormData({
        lotId: lotId,
        entryDate: new Date().toISOString().split('T')[0] || '',
        shift: 'MORNING',
        targetQuantity: 0,
        producedQuantity: 0,
        rejectedQuantity: 0,
        reworkQuantity: 0,
        downtimeMinutes: 0,
        downtimeReason: '',
        qualityIssues: '',
        operatorNotes: '',
        processName: ''
      });
      setEditingEntry(null);
      setShowEditEntry(false);

    } catch (error) {
      console.error('Error updating production entry:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this production entry?')) {
      return;
    }

    try {
      setDeleting(entryId);

      await productionEntriesApi.deleteEntry(entryId);

      // Refresh data after successful delete
      await refreshData();

    } catch (error) {
      console.error('Error deleting production entry:', error);
    } finally {
      setDeleting(null);
    }
  };

  const getShiftColor = (shift: string) => {
    const colors = {
      MORNING: 'bg-yellow-100 text-yellow-600',
      AFTERNOON: 'bg-blue-100 text-blue-600',
      NIGHT: 'bg-purple-100 text-purple-600'
    };
    return colors[shift as keyof typeof colors] || 'bg-gray-100 text-gray-600';
  };

  const getEfficiencyColor = (efficiency: number) => {
    if (efficiency >= 90) return 'text-green-600';
    if (efficiency >= 75) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getEfficiencyIcon = (efficiency: number) => {
    if (efficiency >= 90) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (efficiency >= 75) return <Target className="h-4 w-4 text-yellow-600" />;
    return <TrendingDown className="h-4 w-4 text-red-600" />;
  };

  const filteredEntries = entries.filter(entry => {
    const matchesDate = !filterDate || entry.date === filterDate;
    const matchesProcess = filterProcess === 'all' || entry.processId === filterProcess;
    return matchesDate && matchesProcess;
  });

  // Calculate totals
  const totalTarget = entries.reduce((sum, entry) => sum + entry.targetQuantity, 0);
  const totalProduced = entries.reduce((sum, entry) => sum + entry.producedQuantity, 0);
  const totalRejected = entries.reduce((sum, entry) => sum + entry.rejectedQuantity, 0);
  const totalDowntime = entries.reduce((sum, entry) => sum + entry.downtimeMinutes, 0);
  const overallEfficiency = totalTarget > 0 ? Math.round((totalProduced / totalTarget) * 100) : 0;

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
            <CardTitle className="text-sm font-medium">Target vs Actual</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProduced}/{totalTarget}</div>
            <p className="text-xs text-muted-foreground">
              Units produced vs target
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Efficiency</CardTitle>
            {getEfficiencyIcon(overallEfficiency)}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getEfficiencyColor(overallEfficiency)}`}>
              {overallEfficiency}%
            </div>
            <p className="text-xs text-muted-foreground">
              Production efficiency
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rejected Units</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{totalRejected}</div>
            <p className="text-xs text-muted-foreground">
              {totalProduced > 0 ? `${((totalRejected / totalProduced) * 100).toFixed(1)}% rejection rate` : 'No production yet'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Downtime</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.floor(totalDowntime / 60)}h {totalDowntime % 60}m</div>
            <p className="text-xs text-muted-foreground">
              Equipment downtime
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Production Entry Tabs */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <CardTitle>Production Tracking</CardTitle>
              <CardDescription>
                Record and monitor daily and weekly production metrics
              </CardDescription>
            </div>
            <Dialog open={showNewEntry} onOpenChange={setShowNewEntry}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Entry
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Record Production Entry</DialogTitle>
                  <DialogDescription>
                    Enter production data for a specific process and shift
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="entry-date">Date</Label>
                      <Input
                        id="entry-date"
                        type="date"
                        value={formData.entryDate || ''}
                        onChange={(e) => setFormData({ ...formData, entryDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="shift">Shift</Label>
                      <Select value={formData.shift} onValueChange={(value) => setFormData({ ...formData, shift: value as 'MORNING' | 'AFTERNOON' | 'NIGHT' })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select shift" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MORNING">Morning (6 AM - 2 PM)</SelectItem>
                          <SelectItem value="AFTERNOON">Afternoon (2 PM - 10 PM)</SelectItem>
                          <SelectItem value="NIGHT">Night (10 PM - 6 AM)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="process">Process</Label>
                    <Input
                      id="process"
                      value={formData.processName || ''}
                      onChange={(e) => setFormData({ ...formData, processName: e.target.value })}
                      placeholder="Enter process name"
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <Label htmlFor="target">Target Qty</Label>
                      <Input
                        id="target"
                        type="number"
                        value={formData.targetQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, targetQuantity: Number(e.target.value) })}
                        placeholder="10"
                      />
                    </div>
                    <div>
                      <Label htmlFor="produced">Produced</Label>
                      <Input
                        id="produced"
                        type="number"
                        value={formData.producedQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, producedQuantity: Number(e.target.value) })}
                        placeholder="8"
                      />
                    </div>
                    <div>
                      <Label htmlFor="rejected">Rejected</Label>
                      <Input
                        id="rejected"
                        type="number"
                        value={formData.rejectedQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, rejectedQuantity: Number(e.target.value) })}
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="rework">Rework</Label>
                      <Input
                        id="rework"
                        type="number"
                        value={formData.reworkQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, reworkQuantity: Number(e.target.value) })}
                        placeholder="1"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="downtime">Downtime (minutes)</Label>
                      <Input
                        id="downtime"
                        type="number"
                        value={formData.downtimeMinutes || 0}
                        onChange={(e) => setFormData({ ...formData, downtimeMinutes: Number(e.target.value) })}
                        placeholder="30"
                      />
                    </div>
                    <div>
                      <Label htmlFor="downtime-reason">Downtime Reason</Label>
                      <Input
                        id="downtime-reason"
                        value={formData.downtimeReason || ''}
                        onChange={(e) => setFormData({ ...formData, downtimeReason: e.target.value })}
                        placeholder="Equipment maintenance"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="quality-issues">Quality Issues</Label>
                    <Textarea
                      id="quality-issues"
                      value={formData.qualityIssues || ''}
                      onChange={(e) => setFormData({ ...formData, qualityIssues: e.target.value })}
                      placeholder="Describe any quality issues observed"
                    />
                  </div>
                  <div>
                    <Label htmlFor="notes">Operator Notes</Label>
                    <Textarea
                      id="notes"
                      value={formData.operatorNotes || ''}
                      onChange={(e) => setFormData({ ...formData, operatorNotes: e.target.value })}
                      placeholder="Additional notes or observations"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleSaveEntry}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save Entry'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Edit Entry Dialog */}
            <Dialog open={showEditEntry} onOpenChange={setShowEditEntry}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Edit Production Entry</DialogTitle>
                  <DialogDescription>
                    Update production data for this entry
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="edit-entry-date">Date</Label>
                      <Input
                        id="edit-entry-date"
                        type="date"
                        value={formData.entryDate || ''}
                        onChange={(e) => setFormData({ ...formData, entryDate: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-shift">Shift</Label>
                      <Select value={formData.shift} onValueChange={(value) => setFormData({ ...formData, shift: value as 'MORNING' | 'AFTERNOON' | 'NIGHT' })}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select shift" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="MORNING">Morning (6 AM - 2 PM)</SelectItem>
                          <SelectItem value="AFTERNOON">Afternoon (2 PM - 10 PM)</SelectItem>
                          <SelectItem value="NIGHT">Night (10 PM - 6 AM)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="edit-process">Process</Label>
                    <Input
                      id="edit-process"
                      value={formData.processName || ''}
                      onChange={(e) => setFormData({ ...formData, processName: e.target.value })}
                      placeholder="Enter process name"
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <Label htmlFor="edit-target">Target Qty</Label>
                      <Input
                        id="edit-target"
                        type="number"
                        value={formData.targetQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, targetQuantity: Number(e.target.value) })}
                        placeholder="10"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-produced">Produced</Label>
                      <Input
                        id="edit-produced"
                        type="number"
                        value={formData.producedQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, producedQuantity: Number(e.target.value) })}
                        placeholder="8"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-rejected">Rejected</Label>
                      <Input
                        id="edit-rejected"
                        type="number"
                        value={formData.rejectedQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, rejectedQuantity: Number(e.target.value) })}
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-rework">Rework</Label>
                      <Input
                        id="edit-rework"
                        type="number"
                        value={formData.reworkQuantity || 0}
                        onChange={(e) => setFormData({ ...formData, reworkQuantity: Number(e.target.value) })}
                        placeholder="1"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="edit-downtime">Downtime (minutes)</Label>
                      <Input
                        id="edit-downtime"
                        type="number"
                        value={formData.downtimeMinutes || 0}
                        onChange={(e) => setFormData({ ...formData, downtimeMinutes: Number(e.target.value) })}
                        placeholder="30"
                      />
                    </div>
                    <div>
                      <Label htmlFor="edit-downtime-reason">Downtime Reason</Label>
                      <Input
                        id="edit-downtime-reason"
                        value={formData.downtimeReason || ''}
                        onChange={(e) => setFormData({ ...formData, downtimeReason: e.target.value })}
                        placeholder="Equipment maintenance"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="edit-quality-issues">Quality Issues</Label>
                    <Textarea
                      id="edit-quality-issues"
                      value={formData.qualityIssues || ''}
                      onChange={(e) => setFormData({ ...formData, qualityIssues: e.target.value })}
                      placeholder="Describe any quality issues observed"
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-notes">Operator Notes</Label>
                    <Textarea
                      id="edit-notes"
                      value={formData.operatorNotes || ''}
                      onChange={(e) => setFormData({ ...formData, operatorNotes: e.target.value })}
                      placeholder="Additional notes or observations"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleUpdateEntry}
                    disabled={saving}
                  >
                    {saving ? 'Updating...' : 'Update Entry'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={entryType} onValueChange={(value: any) => setEntryType(value)}>
            <TabsList>
              <TabsTrigger value="daily">Daily Entries</TabsTrigger>
              <TabsTrigger value="weekly">Weekly Summary</TabsTrigger>
            </TabsList>

            <TabsContent value="daily" className="space-y-4">
              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="date-filter">Filter by Date</Label>
                  <Input
                    id="date-filter"
                    type="date"
                    value={filterDate}
                    onChange={(e) => setFilterDate(e.target.value)}
                  />
                </div>
                <div className="w-full sm:w-48">
                  <Label htmlFor="process-filter">Filter by Process</Label>
                  <Select value={filterProcess} onValueChange={setFilterProcess}>
                    <SelectTrigger>
                      <SelectValue placeholder="All processes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Processes</SelectItem>
                      <SelectItem value="1">Material Preparation</SelectItem>
                      <SelectItem value="2">Assembly</SelectItem>
                      <SelectItem value="3">Testing & Quality Control</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Daily Entries Table */}
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date & Shift</TableHead>
                      <TableHead>Process</TableHead>
                      <TableHead>Production</TableHead>
                      <TableHead>Quality</TableHead>
                      <TableHead>Downtime</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEntries.map((entry) => {
                      const efficiency = Math.round((entry.producedQuantity / entry.targetQuantity) * 100);
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="font-medium">
                                {new Date(entry.date).toLocaleDateString()}
                              </div>
                              <Badge className={getShiftColor(entry.shift)} variant="outline">
                                {entry.shift}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{entry.processName}</div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{entry.producedQuantity}/{entry.targetQuantity}</span>
                                <div className={`text-sm ${getEfficiencyColor(efficiency)}`}>
                                  ({efficiency}%)
                                </div>
                              </div>
                              {entry.reworkQuantity > 0 && (
                                <div className="text-xs text-orange-600">
                                  {entry.reworkQuantity} rework
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {entry.rejectedQuantity > 0 ? (
                                <div className="flex items-center gap-2">
                                  <XCircle className="h-4 w-4 text-red-500" />
                                  <span className="text-red-600">{entry.rejectedQuantity} rejected</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                  <span className="text-green-600">No rejects</span>
                                </div>
                              )}
                              {entry.qualityIssues && (
                                <div className="text-xs text-orange-600 max-w-48 truncate">
                                  {entry.qualityIssues}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="font-medium">{entry.downtimeMinutes}m</div>
                              {entry.downtimeReason && (
                                <div className="text-xs text-muted-foreground max-w-32 truncate">
                                  {entry.downtimeReason}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {entry.operatorNotes && (
                              <div className="text-xs text-muted-foreground max-w-48 truncate">
                                {entry.operatorNotes}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEditEntry(entry)}
                                disabled={deleting === entry.id}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteEntry(entry.id)}
                                disabled={deleting === entry.id}
                                className="text-red-600 hover:text-red-700"
                              >
                                {deleting === entry.id ? (
                                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
                                ) : (
                                  <XCircle className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {filteredEntries.length === 0 && (
                <div className="text-center py-8">
                  <BarChart3 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <div className="text-lg font-medium mb-2">No production entries found</div>
                  <div className="text-muted-foreground">
                    {filterDate || filterProcess !== 'all'
                      ? 'Try adjusting your filter criteria'
                      : 'Start recording daily production data'
                    }
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="weekly" className="space-y-4">
              {/* Weekly Summary Table */}
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Week</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead>Produced</TableHead>
                      <TableHead>Rejected</TableHead>
                      <TableHead>Efficiency</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyEntries.map((week, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div className="font-medium">{week.week}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{week.targetQuantity}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{week.producedQuantity}</div>
                        </TableCell>
                        <TableCell>
                          <div className={`font-medium ${week.rejectedQuantity > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {week.rejectedQuantity}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className={`flex items-center gap-2 font-medium ${getEfficiencyColor(week.efficiency)}`}>
                            {getEfficiencyIcon(week.efficiency)}
                            {week.efficiency}%
                          </div>
                        </TableCell>
                        <TableCell>
                          {week.producedQuantity >= week.targetQuantity ? (
                            <Badge className="bg-green-100 text-green-600">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              On Track
                            </Badge>
                          ) : week.producedQuantity === 0 ? (
                            <Badge className="bg-gray-100 text-gray-600">
                              <Clock className="h-3 w-3 mr-1" />
                              Planned
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-600">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Behind
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};