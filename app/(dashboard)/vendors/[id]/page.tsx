'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';

import { VendorStatusBadge } from '@/components/features/vendors/VendorStatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Edit,
  Building2,
  Factory,
  Users,
  Award,
  FileText,
  MoreVertical,
} from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageSkeleton } from '@/components/ui/loading-skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useVendor,
  useVendorEquipment,
  useCreateVendorEquipment,
  useUpdateVendorEquipment,
  useDeleteVendorEquipment,
  useVendorContacts,
  useUpdateVendor,
} from '@/lib/api/hooks/useVendors';
import type { VendorEquipment } from '@/lib/api/vendors';
import { EQUIPMENT_TYPES, EQUIPMENT_CATEGORIES, getAllCategories, getEquipmentTypesByCategory, getFieldsForCategory, type FieldConfig, type EquipmentCategory } from '@/lib/constants/equipment-types';
import { normalizeWebsiteUrl } from '@/lib/utils/website-url';

import type { ReactNode } from 'react';

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

type TabType = 'basic' | 'equipment' | 'facility' | 'qms' | 'users' | 'docs';

export default function VendorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const vendorId = params.id as string;

  const [activeTab, setActiveTab] = useState<TabType>('basic');
  const [equipmentSheetOpen, setEquipmentSheetOpen] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<VendorEquipment | null>(null);
  const [equipmentForm, setEquipmentForm] = useState<Partial<VendorEquipment>>({});
  const [selectedCategory, setSelectedCategory] = useState<EquipmentCategory>(getAllCategories()[0] ?? EQUIPMENT_CATEGORIES.RAW_MATERIAL);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<any>({});

  // Handle URL query parameters
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'equipment') {
      setActiveTab('equipment');
      // Automatically open the equipment sheet when coming from "Add Equipment" button
      setTimeout(() => {
        setSelectedEquipment(null);
        setEquipmentForm({ vendorId });
        setEquipmentSheetOpen(true);
      }, 100);
    }
  }, [searchParams, vendorId]);

  const { data: vendor, isLoading: vendorLoading } = useVendor(vendorId);
  const { data: equipment = [], isLoading: equipmentLoading } = useVendorEquipment(vendorId);
  const { data: contacts = [] } = useVendorContacts(vendorId);

  const createEquipmentMutation = useCreateVendorEquipment();
  const updateEquipmentMutation = useUpdateVendorEquipment();
  const deleteEquipmentMutation = useDeleteVendorEquipment();
  const updateVendorMutation = useUpdateVendor();

  // Services, Shared RFQs and CNC Machining removed: none of the three had a
  // content panel, so every one of them rendered an empty page. CNC Machining
  // was also a process-specific tab hardcoded into a generic vendor screen.
  const tabs = [
    { id: 'basic', label: 'Basic', icon: Building2 },
    { id: 'facility', label: 'Facility', icon: Building2 },
    { id: 'qms', label: 'QMS', icon: Award },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'docs', label: 'Docs', icon: FileText },
    { id: 'equipment', label: 'Equipment', icon: Factory },
  ];

  const handleAddEquipment = () => {
    setSelectedEquipment(null);
    setEquipmentForm({ vendorId });
    setEquipmentSheetOpen(true);
  };

  const handleEditEquipment = (equip: VendorEquipment) => {
    setSelectedEquipment(equip);
    setEquipmentForm(equip);
    setEquipmentSheetOpen(true);
  };

  const handleSelectEquipmentType = (equipmentTypeId: string) => {
    setEquipmentForm({ ...equipmentForm, equipmentType: equipmentTypeId });
  };

  const handleDeleteEquipment = async (id: string) => {
    if (!confirm('Are you sure you want to delete this equipment?')) return;

    deleteEquipmentMutation.mutate({ id, vendorId });
  };

  const handleSaveEquipment = () => {
    if (selectedEquipment) {
      updateEquipmentMutation.mutate(
        { id: selectedEquipment.id, data: equipmentForm },
        {
          onSuccess: () => {
            setEquipmentSheetOpen(false);
            setEquipmentForm({});
          },
        }
      );
    } else {
      createEquipmentMutation.mutate(
        { ...equipmentForm, vendorId },
        {
          onSuccess: () => {
            setEquipmentSheetOpen(false);
            setEquipmentForm({});
          },
        }
      );
    }
  };

  const handleEditVendor = () => {
    if (!vendor) return;
    setEditForm({
      name: vendor.name,
      supplierCode: vendor.supplierCode,
      website: vendor.website,
      companyPhone: vendor.companyPhone,
      companyEmail: vendor.companyEmail || '',
      addresses: vendor.addresses,
      city: vendor.city,
      state: vendor.state,
      country: vendor.country,
      status: vendor.status,
      industries: vendor.industries || [],
      process: vendor.process || [],
      certifications: vendor.certifications || [],
    });
    setEditDialogOpen(true);
  };

  const handleSaveVendor = () => {
    updateVendorMutation.mutate(
      { id: vendorId, data: editForm },
      {
        onSuccess: () => {
          setEditDialogOpen(false);
          setEditForm({});
        },
      }
    );
  };

  if (vendorLoading) {
    return (
      <PageSkeleton label="Loading vendor details..." />
    );
  }

  if (!vendor) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Vendor not found</p>
          <Button onClick={() => { router.push('/vendors'); }} className="mt-4">
            Back to Vendors
          </Button>
        </div>
      </div>
    );
  }

  // Document links are rendered only as http(s) URLs (normalizeWebsiteUrl), never as javascript: or relative links.
  const companyProfileHref = normalizeWebsiteUrl(vendor.companyProfileUrl);
  const machineListHref = normalizeWebsiteUrl(vendor.machineListUrl);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 h-8 w-8 shrink-0"
          aria-label="Back to vendors"
          onClick={() => { router.push('/vendors'); }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
            title={vendor.name}
            {...(vendor.supplierCode ? { description: vendor.supplierCode } : {})}
          >
            <VendorStatusBadge status={vendor.status} />
            <Button variant="outline" className="gap-2" onClick={handleEditVendor}>
              <Edit className="h-4 w-4" />
              Edit Supplier
            </Button>
          </PageHeader>
        </div>
      </div>

      {/* Section tabs */}
      <nav aria-label="Vendor sections" className="-mb-2 overflow-x-auto border-b">
        <ul className="flex min-w-max items-center gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <li key={tab.id}>
                <button
                  type="button"
                  onClick={() => { setActiveTab(tab.id as TabType); }}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {tab.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>
          {activeTab === 'basic' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader className="border-b py-4">
                  <CardTitle className="text-base">Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 p-6">
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
                    <Field label="Company Name">{vendor.name}</Field>
                    <Field label="Supplier Code">{vendor.supplierCode || 'N/A'}</Field>
                    <Field label="Address" className="sm:col-span-2">{vendor.addresses || 'N/A'}</Field>
                    <Field label="Website">
                      {normalizeWebsiteUrl(vendor.website) ? (
                        <a href={normalizeWebsiteUrl(vendor.website)!} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {vendor.website}
                        </a>
                      ) : (vendor.website || 'N/A')}
                    </Field>
                    <Field label="Phone">{vendor.companyPhone || 'N/A'}</Field>
                    <Field label="Email">{vendor.companyEmail || 'N/A'}</Field>
                    <Field label="City">{vendor.city || 'N/A'}</Field>
                    <Field label="State">{vendor.state || 'N/A'}</Field>
                  </dl>

                  <Separator />

                  <div className="space-y-5">
                    <div>
                      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Industries</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {vendor.industries && vendor.industries.length > 0 ? (
                          vendor.industries.map((industry) => (
                            <Badge key={industry} variant="outline">{industry}</Badge>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No industries listed</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Processes</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {vendor.process && vendor.process.length > 0 ? (
                          vendor.process.map((proc) => (
                            <Badge key={proc} variant="outline">{proc}</Badge>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No processes listed</p>
                        )}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Certifications</Label>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {vendor.certifications && vendor.certifications.length > 0 ? (
                          vendor.certifications.map((cert) => (
                            <Badge key={cert} variant="secondary">{cert}</Badge>
                          ))
                        ) : (
                          <p className="text-sm text-muted-foreground">No certifications listed</p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {contacts.length > 0 && (
                <Card className="self-start">
                  <CardHeader className="border-b py-4">
                    <CardTitle className="text-base">Contacts</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4">
                    {contacts.map((contact) => (
                      <div key={contact.id} className="rounded-md border bg-muted/30 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{contact.name}</p>
                            {contact.designation && (
                              <p className="text-sm text-muted-foreground">{contact.designation}</p>
                            )}
                          </div>
                          {contact.isPrimary && (
                            <Badge variant="default">Primary</Badge>
                          )}
                        </div>
                        <div className="mt-2 space-y-1">
                          {contact.email && (
                            <p className="break-all text-sm">
                              <span className="text-muted-foreground">Email:</span> {contact.email}
                            </p>
                          )}
                          {contact.phone && (
                            <p className="text-sm">
                              <span className="text-muted-foreground">Phone:</span> {contact.phone}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {activeTab === 'equipment' && (
            <Card className="overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b px-6 py-4">
                <CardTitle className="text-base">Equipments</CardTitle>
                <Button onClick={handleAddEquipment} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Equipment
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {equipmentLoading ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">Loading equipment...</p>
                  </div>
                ) : equipment.length === 0 ? (
                  <EmptyState icon={Factory} title="No equipment added yet" />
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-6">Manufacturer</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Sub Type</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Yr of Manufacture</TableHead>
                        <TableHead className="text-right">Market Price</TableHead>
                        <TableHead className="w-12 text-right">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {equipment.map((equip) => (
                        <TableRow key={equip.id}>
                          <TableCell className="px-6 font-medium">{equip.manufacturer || '-'}</TableCell>
                          <TableCell>{equip.model || '-'}</TableCell>
                          <TableCell>
                            {EQUIPMENT_TYPES.find(t => t.id === equip.equipmentType)?.name || equip.equipmentType || '-'}
                          </TableCell>
                          <TableCell>{equip.equipmentSubtype || '-'}</TableCell>
                          <TableCell className="text-right tabular-nums">{equip.quantity || 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{equip.yearOfManufacture || 0}</TableCell>
                          <TableCell className="text-right tabular-nums">{equip.marketPrice || 0}</TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Equipment actions">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => { handleEditEquipment(equip); }}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Details
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onSelect={() => handleDeleteEquipment(equip.id)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'facility' && (
            <Card>
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Facility Information</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Manufacturing Workshop">{vendor.manufacturingWorkshop || 'N/A'}</Field>
                  <Field label="Maximum Production Capacity">{vendor.maximumProductionCapacity || 'N/A'}</Field>
                  <Field label="Warehouse">{vendor.warehouse ? 'Yes' : 'No'}</Field>
                  <Field label="Packing">{vendor.packing ? 'Yes' : 'No'}</Field>
                  <Field label="Logistics & Transportation">{vendor.logisticsTransportation ? 'Yes' : 'No'}</Field>
                  <Field label="In-House Material Testing">{vendor.inHouseMaterialTesting ? 'Yes' : 'No'}</Field>
                  <Field label="Hours in Shift">{vendor.numHoursInShift || 'N/A'}</Field>
                  <Field label="Shifts per Day">{vendor.numShiftsInDay || 'N/A'}</Field>
                  <Field label="Working Days per Week">{vendor.numWorkingDaysPerWeek || 'N/A'}</Field>
                  <Field label="Average Capacity Utilization">{vendor.averageCapacityUtilization ? `${vendor.averageCapacityUtilization}%` : 'N/A'}</Field>
                </dl>
              </CardContent>
            </Card>
          )}

          {activeTab === 'users' && (
            <Card>
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Staff Information</CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                  <div className="rounded-md border bg-muted/30 p-4">
                    <dt className="text-xs font-medium text-muted-foreground">Number of Operators</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums">{vendor.numOperators || 0}</dd>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-4">
                    <dt className="text-xs font-medium text-muted-foreground">Number of Engineers</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums">{vendor.numEngineers || 0}</dd>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-4">
                    <dt className="text-xs font-medium text-muted-foreground">Number of Production Managers</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums">{vendor.numProductionManagers || 0}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          )}

          {activeTab === 'qms' && (
            <Card>
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Quality Management System</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div>
                  <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Certifications</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {vendor.certifications && vendor.certifications.length > 0 ? (
                      vendor.certifications.map((cert) => (
                        <Badge key={cert} variant="secondary">{cert}</Badge>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No certifications</p>
                    )}
                  </div>
                </div>
                <Separator />
                <dl className="space-y-5">
                  <Field label="Inspection Options">{vendor.inspectionOptions || 'N/A'}</Field>
                  <Field label="QMS Metrics">{vendor.qmsMetrics || 'N/A'}</Field>
                  <Field label="QMS Procedures">{vendor.qmsProcedures || 'N/A'}</Field>
                </dl>
              </CardContent>
            </Card>
          )}

          {activeTab === 'docs' && (
            <Card>
              <CardHeader className="border-b py-4">
                <CardTitle className="text-base">Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                {companyProfileHref && (
                  <dl>
                    <Field label="Company Profile">
                      <a href={companyProfileHref} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        View Company Profile
                      </a>
                    </Field>
                  </dl>
                )}
                {machineListHref && (
                  <dl>
                    <Field label="Machine List">
                      <a href={machineListHref} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        View Machine List
                      </a>
                    </Field>
                  </dl>
                )}
                {!companyProfileHref && !machineListHref && (
                  <p className="text-sm text-muted-foreground">No documents available</p>
                )}
              </CardContent>
            </Card>
          )}
      </div>

      {/* Equipment Sheet */}
      <Sheet open={equipmentSheetOpen} onOpenChange={setEquipmentSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selectedEquipment ? 'Edit Equipment' : 'Add Equipment'}</SheetTitle>
            <SheetDescription>
              Select equipment type and enter details
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Equipment Type Selector with Tabs */}
            <div>
              <Label className="text-base font-semibold">Select Equipment Type</Label>
              <Tabs value={selectedCategory} onValueChange={(val) => { setSelectedCategory(val as EquipmentCategory); }} className="mt-3">
                {/* Scrollable tabs list */}
                <div className="relative mb-4 overflow-x-auto">
                  <TabsList className="inline-flex w-max min-w-full">
                    {getAllCategories().map((category) => (
                      <TabsTrigger
                        key={category}
                        value={category}
                        className="text-xs px-3 py-2 whitespace-nowrap"
                      >
                        {category}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>

                {getAllCategories().map((category) => {
                  const categoryTypes = getEquipmentTypesByCategory(category);
                  if (categoryTypes.length === 0) return null;

                  return (
                    <TabsContent key={category} value={category} className="mt-0">
                      <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto p-3 border rounded-md bg-muted/30">
                        {categoryTypes.map((type) => (
                          <Button
                            key={type.id}
                            variant={equipmentForm.equipmentType === type.id ? "default" : "outline"}
                            className="h-auto py-3 text-sm font-normal justify-start"
                            onClick={() => { handleSelectEquipmentType(type.id); }}
                          >
                            {type.name}
                          </Button>
                        ))}
                      </div>
                    </TabsContent>
                  );
                })}
              </Tabs>

              {equipmentForm.equipmentType && (
                <div className="mt-3 p-3 bg-primary/10 rounded-md">
                  <p className="text-sm font-medium">
                    Selected: {EQUIPMENT_TYPES.find(t => t.id === equipmentForm.equipmentType)?.name}
                  </p>
                </div>
              )}
            </div>

            <Separator />

            {/* Equipment Details Form - Dynamic based on selected category */}
            <div className="space-y-4">
              <h3 className="text-base font-semibold">Equipment Details</h3>

              <div className="space-y-4">
                {(() => {
                  const category = selectedCategory ?? EQUIPMENT_CATEGORIES.RAW_MATERIAL;
                  const fields = getFieldsForCategory(category);
                  const groupedFields: Record<string, FieldConfig[]> = {};
                  const ungroupedFields: FieldConfig[] = [];

                  // Group fields
                  fields.forEach(field => {
                    if (field.group) {
                      const groupKey = field.group;
                      (groupedFields[groupKey] ??= []).push(field);
                    } else {
                      ungroupedFields.push(field);
                    }
                  });

                  return (
                    <>
                      {/* Ungrouped fields in 2 columns */}
                      {ungroupedFields.length > 0 && (
                        <div className="grid grid-cols-2 gap-4">
                          {ungroupedFields.map((field: FieldConfig) => (
                            <div key={field.name}>
                              <Label>{field.label}</Label>
                              <Input
                                type={field.type}
                                value={(equipmentForm as any)[field.name] || ''}
                                onChange={(e) => {
                                  const value = field.type === 'number'
                                    ? (e.target.value ? parseFloat(e.target.value) : undefined)
                                    : e.target.value;
                                  setEquipmentForm({ ...equipmentForm, [field.name]: value });
                                }}
                                placeholder={field.placeholder}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Grouped fields */}
                      {Object.entries(groupedFields).map(([groupKey, groupFields]) => {
                        const groupLabel = groupFields[0]?.groupLabel || groupKey;
                        return (
                          <div key={groupKey} className="space-y-2">
                            <Label className="text-sm font-semibold">{groupLabel}</Label>
                            <div className="grid grid-cols-3 gap-3 p-3 border rounded-md bg-muted/50">
                              {groupFields.map((field: FieldConfig) => (
                                <div key={field.name}>
                                  <Label className="text-xs text-muted-foreground">{field.label}</Label>
                                  <Input
                                    type={field.type}
                                    value={(equipmentForm as any)[field.name] || ''}
                                    onChange={(e) => {
                                      const value = field.type === 'number'
                                        ? (e.target.value ? parseFloat(e.target.value) : undefined)
                                        : e.target.value;
                                      setEquipmentForm({ ...equipmentForm, [field.name]: value });
                                    }}
                                    placeholder={field.placeholder}
                                    className="h-8 text-sm"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button variant="outline" onClick={() => { setEquipmentSheetOpen(false); }}>
                Cancel
              </Button>
              <Button
                onClick={handleSaveEquipment}
                disabled={createEquipmentMutation.isPending || updateEquipmentMutation.isPending}
              >
                {selectedEquipment ? 'Update' : 'Add'} Equipment
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Vendor Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Supplier</DialogTitle>
            <DialogDescription>
              Update supplier information. Click save when you're done.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Basic Information */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="name">Company Name *</Label>
                <Input
                  id="name"
                  value={editForm.name || ''}
                  onChange={(e) => { setEditForm({ ...editForm, name: e.target.value }); }}
                  placeholder="Enter company name"
                />
              </div>
              <div>
                <Label htmlFor="supplierCode">Supplier Code</Label>
                <Input
                  id="supplierCode"
                  value={editForm.supplierCode || ''}
                  onChange={(e) => { setEditForm({ ...editForm, supplierCode: e.target.value }); }}
                  placeholder="Enter supplier code"
                />
              </div>
              <div>
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  type="url"
                  value={editForm.website || ''}
                  onChange={(e) => { setEditForm({ ...editForm, website: e.target.value }); }}
                  placeholder="https://example.com"
                />
              </div>
              <div>
                <Label htmlFor="companyPhone">Company Phone</Label>
                <Input
                  id="companyPhone"
                  type="tel"
                  value={editForm.companyPhone || ''}
                  onChange={(e) => { setEditForm({ ...editForm, companyPhone: e.target.value }); }}
                  placeholder="+1 234 567 8900"
                />
              </div>
              <div>
                <Label htmlFor="companyEmail">Company Email</Label>
                <Input
                  id="companyEmail"
                  type="email"
                  value={editForm.companyEmail || ''}
                  onChange={(e) => { setEditForm({ ...editForm, companyEmail: e.target.value }); }}
                  placeholder="info@company.com"
                />
              </div>
            </div>

            {/* Address */}
            <div>
              <Label htmlFor="addresses">Address</Label>
              <Textarea
                id="addresses"
                value={editForm.addresses || ''}
                onChange={(e) => { setEditForm({ ...editForm, addresses: e.target.value }); }}
                placeholder="Enter full address"
                rows={3}
              />
            </div>

            {/* Location */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={editForm.city || ''}
                  onChange={(e) => { setEditForm({ ...editForm, city: e.target.value }); }}
                  placeholder="Enter city"
                />
              </div>
              <div>
                <Label htmlFor="state">State/Province</Label>
                <Input
                  id="state"
                  value={editForm.state || ''}
                  onChange={(e) => { setEditForm({ ...editForm, state: e.target.value }); }}
                  placeholder="Enter state"
                />
              </div>
              <div>
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={editForm.country || ''}
                  onChange={(e) => { setEditForm({ ...editForm, country: e.target.value }); }}
                  placeholder="Enter country"
                />
              </div>
            </div>

            {/* Status */}
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={editForm.status || 'active'}
                onValueChange={(value) => { setEditForm({ ...editForm, status: value }); }}
              >
                <SelectTrigger id="status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Industries */}
            <div>
              <Label htmlFor="industries">Industries (comma-separated)</Label>
              <Input
                id="industries"
                value={editForm.industries?.join(', ') || ''}
                onChange={(e) => { setEditForm({
                  ...editForm,
                  industries: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                }); }}
                placeholder="e.g., Aerospace, Automotive, Medical"
              />
            </div>

            {/* Process */}
            <div>
              <Label htmlFor="process">Process Capabilities (comma-separated)</Label>
              <Input
                id="process"
                value={editForm.process?.join(', ') || ''}
                onChange={(e) => { setEditForm({
                  ...editForm,
                  process: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                }); }}
                placeholder="e.g., CNC Machining, Casting, Sheet Metal"
              />
            </div>

            {/* Certifications */}
            <div>
              <Label htmlFor="certifications">Certifications (comma-separated)</Label>
              <Input
                id="certifications"
                value={editForm.certifications?.join(', ') || ''}
                onChange={(e) => { setEditForm({
                  ...editForm,
                  certifications: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                }); }}
                placeholder="e.g., ISO 9001, AS9100, IATF 16949"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditDialogOpen(false); }}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveVendor}
              disabled={updateVendorMutation.isPending || !editForm.name}
            >
              {updateVendorMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
