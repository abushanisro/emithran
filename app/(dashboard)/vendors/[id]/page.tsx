'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  Settings,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import type { VendorEquipment } from '@/lib/api/vendors';
import { EQUIPMENT_TYPES, EQUIPMENT_CATEGORIES, getAllCategories, getEquipmentTypesByCategory, getFieldsForCategory, type FieldConfig, type EquipmentCategory } from '@/lib/constants/equipment-types';

type TabType = 'basic' | 'services' | 'equipment' | 'facility' | 'shared-rfqs' | 'qms' | 'users' | 'cnc-machining' | 'docs';

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

  const tabs = [
    { id: 'basic', label: 'Basic', icon: Building2 },
    { id: 'services', label: 'Services', icon: Wrench },
    { id: 'equipment', label: 'Equipment', icon: Factory },
    { id: 'facility', label: 'Facility', icon: Building2 },
    { id: 'shared-rfqs', label: 'Shared RFQs', icon: MessageSquare },
    { id: 'qms', label: 'QMS', icon: Award },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'cnc-machining', label: 'CNC Machining', icon: Settings },
    { id: 'docs', label: 'Docs', icon: FileText },
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading vendor details...</p>
        </div>
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Vendor not found</p>
          <Button onClick={() => router.push('/vendors')} className="mt-4">
            Back to Vendors
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b sticky top-0 z-10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/vendors')}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <div>
                <h1 className="text-2xl font-bold">{vendor.name}</h1>
                <p className="text-sm text-muted-foreground">{vendor.supplierCode}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={vendor.status === 'active' ? 'default' : 'secondary'}>
                {vendor.status}
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={handleEditVendor}
              >
                <Edit className="h-4 w-4" />
                Edit Supplier
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 bg-gray-800 text-white min-h-[calc(100vh-73px)] p-4">
          <nav className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-md text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          {activeTab === 'basic' && (
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Company Name</Label>
                    <p className="mt-1">{vendor.name}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Supplier Code</Label>
                    <p className="mt-1">{vendor.supplierCode || 'N/A'}</p>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-sm font-medium text-muted-foreground">Address</Label>
                    <p className="mt-1">{vendor.addresses || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Website</Label>
                    <p className="mt-1">
                      {vendor.website ? (
                        <a href={vendor.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                          {vendor.website}
                        </a>
                      ) : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Phone</Label>
                    <p className="mt-1">{vendor.companyPhone || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Email</Label>
                    <p className="mt-1">{vendor.companyEmail || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">City</Label>
                    <p className="mt-1">{vendor.city || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">State</Label>
                    <p className="mt-1">{vendor.state || 'N/A'}</p>
                  </div>
                </div>

                <Separator />

                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Industries</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
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
                  <Label className="text-sm font-medium text-muted-foreground">Processes</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
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
                  <Label className="text-sm font-medium text-muted-foreground">Certifications</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {vendor.certifications && vendor.certifications.length > 0 ? (
                      vendor.certifications.map((cert) => (
                        <Badge key={cert} variant="secondary">{cert}</Badge>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No certifications listed</p>
                    )}
                  </div>
                </div>

                {contacts.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <Label className="text-sm font-medium text-muted-foreground">Contacts</Label>
                      <div className="mt-3 space-y-3">
                        {contacts.map((contact) => (
                          <Card key={contact.id}>
                            <CardContent className="pt-4">
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium">{contact.name}</p>
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
                                  <p className="text-sm">
                                    <span className="text-muted-foreground">Email:</span> {contact.email}
                                  </p>
                                )}
                                {contact.phone && (
                                  <p className="text-sm">
                                    <span className="text-muted-foreground">Phone:</span> {contact.phone}
                                  </p>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {activeTab === 'equipment' && (
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Equipments</CardTitle>
                </CardHeader>
                <CardContent>
                  {equipmentLoading ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">Loading equipment...</p>
                    </div>
                  ) : equipment.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No equipment added yet</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium">Manufacturer</th>
                            <th className="text-left py-3 px-4 font-medium">Model</th>
                            <th className="text-left py-3 px-4 font-medium">Type</th>
                            <th className="text-left py-3 px-4 font-medium">Sub Type</th>
                            <th className="text-left py-3 px-4 font-medium">Quantity</th>
                            <th className="text-left py-3 px-4 font-medium">Yr of Manufacture</th>
                            <th className="text-left py-3 px-4 font-medium">Market Price</th>
                            <th className="text-left py-3 px-4 font-medium">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {equipment.map((equip) => (
                            <tr key={equip.id} className="border-b hover:bg-primary/5 transition-colors cursor-pointer">
                              <td className="py-3 px-4">{equip.manufacturer || '-'}</td>
                              <td className="py-3 px-4">{equip.model || '-'}</td>
                              <td className="py-3 px-4">
                                {EQUIPMENT_TYPES.find(t => t.id === equip.equipmentType)?.name || equip.equipmentType || '-'}
                              </td>
                              <td className="py-3 px-4">{equip.equipmentSubtype || '-'}</td>
                              <td className="py-3 px-4">{equip.quantity || 0}</td>
                              <td className="py-3 px-4">{equip.yearOfManufacture || 0}</td>
                              <td className="py-3 px-4">{equip.marketPrice || 0}</td>
                              <td className="py-3 px-4">
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleEditEquipment(equip)}
                                    className="gap-1"
                                  >
                                    <Edit className="h-3 w-3" />
                                    Details
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleDeleteEquipment(equip.id)}
                                    className="gap-1 text-red-600 hover:text-red-700"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add Equipment Button at bottom */}
                  <div className="mt-4 pt-4 border-t">
                    <Button onClick={handleAddEquipment} className="gap-2">
                      <Plus className="h-4 w-4" />
                      Add Equipment
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === 'facility' && (
            <Card>
              <CardHeader>
                <CardTitle>Facility Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Manufacturing Workshop</Label>
                    <p className="mt-1">{vendor.manufacturingWorkshop || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Maximum Production Capacity</Label>
                    <p className="mt-1">{vendor.maximumProductionCapacity || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Warehouse</Label>
                    <p className="mt-1">{vendor.warehouse ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Packing</Label>
                    <p className="mt-1">{vendor.packing ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Logistics & Transportation</Label>
                    <p className="mt-1">{vendor.logisticsTransportation ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">In-House Material Testing</Label>
                    <p className="mt-1">{vendor.inHouseMaterialTesting ? 'Yes' : 'No'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Hours in Shift</Label>
                    <p className="mt-1">{vendor.numHoursInShift || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Shifts per Day</Label>
                    <p className="mt-1">{vendor.numShiftsInDay || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Working Days per Week</Label>
                    <p className="mt-1">{vendor.numWorkingDaysPerWeek || 'N/A'}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Average Capacity Utilization</Label>
                    <p className="mt-1">{vendor.averageCapacityUtilization ? `${vendor.averageCapacityUtilization}%` : 'N/A'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'users' && (
            <Card>
              <CardHeader>
                <CardTitle>Staff Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Number of Operators</Label>
                    <p className="mt-1 text-2xl font-bold">{vendor.numOperators || 0}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Number of Engineers</Label>
                    <p className="mt-1 text-2xl font-bold">{vendor.numEngineers || 0}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Number of Production Managers</Label>
                    <p className="mt-1 text-2xl font-bold">{vendor.numProductionManagers || 0}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'qms' && (
            <Card>
              <CardHeader>
                <CardTitle>Quality Management System</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Certifications</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {vendor.certifications && vendor.certifications.length > 0 ? (
                      vendor.certifications.map((cert) => (
                        <Badge key={cert} variant="secondary">{cert}</Badge>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No certifications</p>
                    )}
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">Inspection Options</Label>
                  <p className="mt-1">{vendor.inspectionOptions || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">QMS Metrics</Label>
                  <p className="mt-1">{vendor.qmsMetrics || 'N/A'}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium text-muted-foreground">QMS Procedures</Label>
                  <p className="mt-1">{vendor.qmsProcedures || 'N/A'}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'docs' && (
            <Card>
              <CardHeader>
                <CardTitle>Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {vendor.companyProfileUrl && (
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Company Profile</Label>
                    <p className="mt-1">
                      <a href={vendor.companyProfileUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        View Company Profile
                      </a>
                    </p>
                  </div>
                )}
                {vendor.machineListUrl && (
                  <div>
                    <Label className="text-sm font-medium text-muted-foreground">Machine List</Label>
                    <p className="mt-1">
                      <a href={vendor.machineListUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        View Machine List
                      </a>
                    </p>
                  </div>
                )}
                {!vendor.companyProfileUrl && !vendor.machineListUrl && (
                  <p className="text-sm text-muted-foreground">No documents available</p>
                )}
              </CardContent>
            </Card>
          )}
        </main>
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
              <Tabs value={selectedCategory} onValueChange={(val) => setSelectedCategory(val as EquipmentCategory)} className="mt-3">
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
                            onClick={() => handleSelectEquipmentType(type.id)}
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
                      const groupKey = field.group!;
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
              <Button variant="outline" onClick={() => setEquipmentSheetOpen(false)}>
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Company Name *</Label>
                <Input
                  id="name"
                  value={editForm.name || ''}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Enter company name"
                />
              </div>
              <div>
                <Label htmlFor="supplierCode">Supplier Code</Label>
                <Input
                  id="supplierCode"
                  value={editForm.supplierCode || ''}
                  onChange={(e) => setEditForm({ ...editForm, supplierCode: e.target.value })}
                  placeholder="Enter supplier code"
                />
              </div>
              <div>
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  type="url"
                  value={editForm.website || ''}
                  onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                  placeholder="https://example.com"
                />
              </div>
              <div>
                <Label htmlFor="companyPhone">Company Phone</Label>
                <Input
                  id="companyPhone"
                  type="tel"
                  value={editForm.companyPhone || ''}
                  onChange={(e) => setEditForm({ ...editForm, companyPhone: e.target.value })}
                  placeholder="+1 234 567 8900"
                />
              </div>
              <div>
                <Label htmlFor="companyEmail">Company Email</Label>
                <Input
                  id="companyEmail"
                  type="email"
                  value={editForm.companyEmail || ''}
                  onChange={(e) => setEditForm({ ...editForm, companyEmail: e.target.value })}
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
                onChange={(e) => setEditForm({ ...editForm, addresses: e.target.value })}
                placeholder="Enter full address"
                rows={3}
              />
            </div>

            {/* Location */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={editForm.city || ''}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                  placeholder="Enter city"
                />
              </div>
              <div>
                <Label htmlFor="state">State/Province</Label>
                <Input
                  id="state"
                  value={editForm.state || ''}
                  onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                  placeholder="Enter state"
                />
              </div>
              <div>
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={editForm.country || ''}
                  onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                  placeholder="Enter country"
                />
              </div>
            </div>

            {/* Status */}
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={editForm.status || 'active'}
                onValueChange={(value) => setEditForm({ ...editForm, status: value })}
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
                onChange={(e) => setEditForm({
                  ...editForm,
                  industries: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                })}
                placeholder="e.g., Aerospace, Automotive, Medical"
              />
            </div>

            {/* Process */}
            <div>
              <Label htmlFor="process">Process Capabilities (comma-separated)</Label>
              <Input
                id="process"
                value={editForm.process?.join(', ') || ''}
                onChange={(e) => setEditForm({
                  ...editForm,
                  process: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                })}
                placeholder="e.g., CNC Machining, Casting, Sheet Metal"
              />
            </div>

            {/* Certifications */}
            <div>
              <Label htmlFor="certifications">Certifications (comma-separated)</Label>
              <Input
                id="certifications"
                value={editForm.certifications?.join(', ') || ''}
                onChange={(e) => setEditForm({
                  ...editForm,
                  certifications: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                })}
                placeholder="e.g., ISO 9001, AS9100, IATF 16949"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
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
