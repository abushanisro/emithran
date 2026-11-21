'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, useMemo } from 'react';
import { toast } from 'sonner';

import { VendorStatusBadge } from '@/components/features/vendors/VendorStatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Plus, Search, Upload, MapPin, Factory, Award, Filter, Trash2, ExternalLink, TrendingUp, X, ArrowLeft, MoreVertical } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/loading-skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCounterAnimation } from '@/hooks/use-counter-animation';
import { useVendors, useUploadVendorsCsv, useDeleteAllVendors, useCreateVendor } from '@/lib/api/hooks/useVendors';
import type { VendorQuery, CreateVendorData } from '@/lib/api/vendors';
import { EQUIPMENT_TYPES, getAllCategories } from '@/lib/constants/equipment-types';
import { normalizeWebsiteUrl } from '@/lib/utils/website-url';

const IndiaMap = dynamic(() => import('@/components/ui/india-map').then(mod => ({ default: mod.IndiaMap })), { 
  ssr: false,
  loading: () => <div className="h-80 bg-muted animate-pulse rounded-md" />
});

export default function VendorsPage() {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([]);
  const [selectedCertifications, setSelectedCertifications] = useState<string[]>([]);
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedProcess, setSelectedProcess] = useState<string>('');
  const [selectedEquipmentType, setSelectedEquipmentType] = useState<string>('');
  const [minTonnage, setMinTonnage] = useState<string>('');
  const [minBedLength, setMinBedLength] = useState<string>('');
  const [minBedWidth, setMinBedWidth] = useState<string>('');
  const [minBedHeight, setMinBedHeight] = useState<string>('');

  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newVendorData, setNewVendorData] = useState<CreateVendorData>({
    name: '',
    supplierCode: '',
    addresses: '',
    city: '',
    state: '',
    country: 'India',
    website: '',
    companyPhone: '',
    companyEmail: '',
    status: 'active',
    vendorType: 'supplier',
    industries: [] as string[],
    process: [] as string[],
    certifications: [] as string[],
  });
  const [industryInput, setIndustryInput] = useState('');
  const [processInput, setProcessInput] = useState('');
  const [certificationInput, setCertificationInput] = useState('');

  // Build query from filters
  const query: VendorQuery = useMemo(() => {
    // Combine process filters from sidebar checkboxes and process block dropdown
    const processFilters = [...selectedServices];
    if (selectedProcess && selectedProcess !== 'all' && !processFilters.includes(selectedProcess)) {
      processFilters.push(selectedProcess);
    }

    const q: VendorQuery = {
      ...(searchTerm ? { search: searchTerm } : {}),
      ...(processFilters.length > 0 ? { process: processFilters } : {}),
      ...(selectedIndustries.length > 0 ? { industries: selectedIndustries } : {}),
      ...(selectedCertifications.length > 0 ? { certifications: selectedCertifications } : {}),
      ...(selectedCity && selectedCity !== 'all' ? { city: selectedCity } : {}),
      ...(selectedEquipmentType && selectedEquipmentType !== 'all' ? { equipmentType: selectedEquipmentType } : {}),
      ...(minTonnage ? { minTonnage: parseFloat(minTonnage) } : {}),
      limit: 50,
    };
    return q;
  }, [searchTerm, selectedServices, selectedIndustries, selectedCertifications, selectedCity, selectedProcess, selectedEquipmentType, minTonnage]);

  const { data: vendorsData, isLoading } = useVendors(query);
  const vendors = vendorsData?.vendors || [];
  const total = vendorsData?.total || 0;

  // Get all vendors (unfiltered) for filter options
  const allVendorsQuery = useMemo(() => ({ limit: 1000 }), []);
  const { data: allVendorsData } = useVendors(allVendorsQuery);
  const allVendors = allVendorsData?.vendors || [];

  const uploadCsvMutation = useUploadVendorsCsv();
  const deleteAllMutation = useDeleteAllVendors();
  const createVendorMutation = useCreateVendor();

  // Animated counter for total suppliers
  const totalAllVendors = allVendorsData?.total || 0;
  const animatedTotal = useCounterAnimation(totalAllVendors, 1500, !isLoading);
  const activeCount = allVendors.filter(v => v.status === 'active').length;
  const inactiveCount = allVendors.filter(v => v.status === 'inactive').length;
  const animatedActive = useCounterAnimation(activeCount, 1200, !isLoading);
  const animatedInactive = useCounterAnimation(inactiveCount, 1200, !isLoading);

  // Check if any filters are active
  const hasActiveFilters = useMemo(() => !!(
      searchTerm ||
      selectedServices.length > 0 ||
      selectedIndustries.length > 0 ||
      selectedCertifications.length > 0 ||
      (selectedCity && selectedCity !== 'all') ||
      (selectedProcess && selectedProcess !== 'all') ||
      (selectedEquipmentType && selectedEquipmentType !== 'all') ||
      minTonnage
    ), [searchTerm, selectedServices, selectedIndustries, selectedCertifications, selectedCity, selectedProcess, selectedEquipmentType, minTonnage]);

  // Calculate statistics from all vendors
  const stats = useMemo(() => {
    const serviceCount: Record<string, number> = {};
    const locationCount: Record<string, number> = {};

    allVendors.forEach(vendor => {
      vendor.process?.forEach(service => {
        serviceCount[service] = (serviceCount[service] || 0) + 1;
      });

      if (vendor.city) {
        locationCount[vendor.city] = (locationCount[vendor.city] || 0) + 1;
      }
    });

    return {
      byService: Object.entries(serviceCount)
        .sort(([, a], [, b]) => b - a),
      byLocation: Object.entries(locationCount)
        .sort(([, a], [, b]) => b - a),
    };
  }, [allVendors]);

  // Get unique filter options from all vendors
  const filterOptions = useMemo(() => {
    const services = new Set<string>();
    const industries = new Set<string>();
    const certifications = new Set<string>();
    const cities = new Set<string>();
    // States come from the same place every other option list here already
    // comes from: the vendor rows themselves. See the create-vendor form below
    // for why a hardcoded list could not work.
    const states = new Set<string>();
    const citiesByStateFromData = new Map<string, Set<string>>();

    allVendors.forEach(vendor => {
      vendor.process?.forEach(s => services.add(s));
      vendor.industries?.forEach(i => industries.add(i));
      vendor.certifications?.forEach(c => certifications.add(c));
      if (vendor.city) cities.add(vendor.city);
      if (vendor.state) states.add(vendor.state);
      if (vendor.state && vendor.city) {
        const set = citiesByStateFromData.get(vendor.state) ?? new Set<string>();
        set.add(vendor.city);
        citiesByStateFromData.set(vendor.state, set);
      }
    });

    return {
      services: Array.from(services).sort(),
      industries: Array.from(industries).sort(),
      certifications: Array.from(certifications).sort(),
      cities: Array.from(cities).sort(),
      states: Array.from(states).sort(),
      citiesByState: citiesByStateFromData,
    };
  }, [allVendors]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const name = file.name.toLowerCase();
      const isValid = name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls');
      if (!isValid) {
        toast.error('Please select a CSV or Excel (.xlsx) file');
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleUploadCsv = () => {
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }

    uploadCsvMutation.mutate(selectedFile, {
      onSuccess: () => {
        setUploadDialogOpen(false);
        setSelectedFile(null);
      },
    });
  };

  const handleDeleteAll = () => {
    if (!confirm(`Are you sure you want to delete all ${totalAllVendors} vendors? This action cannot be undone.`)) {
      return;
    }

    deleteAllMutation.mutate();
  };

  const handleCreateVendor = () => {
    if (!(newVendorData.name ?? '').trim()) {
      toast.error('Supplier name is required');
      return;
    }

    createVendorMutation.mutate(newVendorData, {
      onSuccess: (vendor) => {
        setCreateDialogOpen(false);
        setNewVendorData({
          name: '',
          supplierCode: '',
          addresses: '',
          city: '',
          state: '',
          country: 'India',
          website: '',
          companyPhone: '',
          companyEmail: '',
          status: 'active',
          vendorType: 'supplier',
          industries: [],
          process: [],
          certifications: [],
        });
        setIndustryInput('');
        setProcessInput('');
        setCertificationInput('');
        // Navigate to the new vendor's detail page
        router.push(`/vendors/${vendor.id}`);
      },
    });
  };

  const addIndustry = () => {
    const value = industryInput.trim();
    if (value && !(newVendorData.industries ?? []).includes(value)) {
      setNewVendorData({
        ...newVendorData,
        industries: [...(newVendorData.industries ?? []), value],
      });
      setIndustryInput('');
    }
  };

  const removeIndustry = (industry: string) => {
    setNewVendorData({
      ...newVendorData,
      industries: (newVendorData.industries ?? []).filter(i => i !== industry),
    });
  };

  const addProcess = () => {
    const value = processInput.trim();
    if (value && !(newVendorData.process ?? []).includes(value)) {
      setNewVendorData({
        ...newVendorData,
        process: [...(newVendorData.process ?? []), value],
      });
      setProcessInput('');
    }
  };

  const removeProcess = (process: string) => {
    setNewVendorData({
      ...newVendorData,
      process: (newVendorData.process ?? []).filter(p => p !== process),
    });
  };

  const addCertification = () => {
    const value = certificationInput.trim();
    if (value && !(newVendorData.certifications ?? []).includes(value)) {
      setNewVendorData({
        ...newVendorData,
        certifications: [...(newVendorData.certifications ?? []), value],
      });
      setCertificationInput('');
    }
  };

  const removeCertification = (cert: string) => {
    setNewVendorData({
      ...newVendorData,
      certifications: (newVendorData.certifications ?? []).filter(c => c !== cert),
    });
  };

  const toggleFilter = (filterArray: string[], setFilter: (val: string[]) => void, value: string) => {
    if (filterArray.includes(value)) {
      setFilter(filterArray.filter(v => v !== value));
    } else {
      setFilter([...filterArray, value]);
    }
  };

  // State/city suggestions come from the vendor records themselves — the same
  // source every other option list on this page uses (see filterOptions).
  //
  // This replaced a hardcoded 36-entry Indian state list and a 20-state,
  // ~130-city map, which could not represent the data actually in the table:
  // of 647 live vendors, real `state` values include 'Shandong Sheng' and
  // 'Baoan Qu' (China), and most of the 48 cities in use were absent from the
  // map. Sixteen of the 36 states had no cities at all, so choosing one gave an
  // empty dropdown.
  //
  // No geography table is invented here either. There is no master
  // states/cities reference data in this system, and seeding one would be
  // fabricating reference data. The vendor row IS the source of truth for where
  // a vendor is, so the field suggests what exists and accepts anything new.
  const stateSuggestions = filterOptions.states;
  const citySuggestions = useMemo(() => {
    // Cities seen in the chosen state first; fall back to every known city so a
    // new state still offers something useful instead of nothing.
    const forState = newVendorData.state
      ? filterOptions.citiesByState.get(newVendorData.state)
      : undefined;
    return forState && forState.size > 0
      ? Array.from(forState).sort()
      : filterOptions.cities;
  }, [newVendorData.state, filterOptions]);

  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedServices([]);
    setSelectedIndustries([]);
    setSelectedCertifications([]);
    setSelectedCity('all');
    setSelectedProcess('all');
    setSelectedEquipmentType('all');
    setMinTonnage('');
  };

  const filterGroups = [
    { label: 'Services', options: filterOptions.services, selected: selectedServices, set: setSelectedServices },
    { label: 'Industry', options: filterOptions.industries, selected: selectedIndustries, set: setSelectedIndustries },
    { label: 'Certification', options: filterOptions.certifications, selected: selectedCertifications, set: setSelectedCertifications },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button
          variant="outline"
          size="icon"
          className="mt-0.5 h-8 w-8 shrink-0"
          aria-label="Back to dashboard"
          onClick={() => { router.push('/'); }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <PageHeader
            title="Supplier Database"
            description="Comprehensive vendor management and filtering"
          >
            <Button variant="outline" onClick={() => { setUploadDialogOpen(true); }} className="gap-2">
              <Upload className="h-4 w-4" />
              Import File
            </Button>
            <Button className="gap-2" onClick={() => { setCreateDialogOpen(true); }}>
              <Plus className="h-4 w-4" />
              Add Supplier
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={totalAllVendors === 0 || deleteAllMutation.isPending}
                  onSelect={handleDeleteAll}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete All
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </PageHeader>
        </div>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Total Suppliers */}
        <Card
          className="cursor-pointer transition-shadow hover:shadow-md"
          onClick={clearAllFilters}
        >
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <Factory className="h-4 w-4" aria-hidden="true" />
                Total Suppliers
              </div>
              {!isLoading && animatedTotal < total && (
                <TrendingUp className="h-4 w-4 animate-pulse text-success" aria-hidden="true" />
              )}
            </div>
            <div className="text-4xl font-semibold tabular-nums tracking-tight text-primary">
              {animatedTotal.toLocaleString()}
            </div>

            {totalAllVendors > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-success transition-all duration-1000 ease-out"
                  style={{ width: `${(activeCount / totalAllVendors) * 100}%` }}
                />
              </div>
            )}

            <dl className="space-y-1.5 border-t pt-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  Active
                </dt>
                <dd className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {totalAllVendors > 0 ? Math.round((activeCount / totalAllVendors) * 100) : 0}%
                  </span>
                  <Badge variant="secondary" className="min-w-10 justify-center bg-success/10 text-success tabular-nums">
                    {animatedActive}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  Inactive
                </dt>
                <dd className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {totalAllVendors > 0 ? Math.round((inactiveCount / totalAllVendors) * 100) : 0}%
                  </span>
                  <Badge variant="secondary" className="min-w-10 justify-center tabular-nums">
                    {animatedInactive}
                  </Badge>
                </dd>
              </div>
            </dl>

            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                clearAllFilters();
              }}
            >
              View All Suppliers
            </Button>
          </CardContent>
        </Card>

        {/* Suppliers by Service */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Factory className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              # Suppliers by Service
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {filterOptions.services.length} Services
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="custom-scrollbar max-h-64 space-y-1 overflow-y-auto pr-2">
              {filterOptions.services.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">No services found</div>
              ) : (
                filterOptions.services.map((service) => {
                  const totalCount = allVendors.filter(v => v.process?.includes(service)).length;
                  const filteredCount = vendors.filter(v => v.process?.includes(service)).length;
                  const isSelected = selectedServices.includes(service) || selectedProcess === service;
                  const displayCount = hasActiveFilters ? filteredCount : totalCount;

                  return (
                    <div
                      key={service}
                      className={`flex cursor-pointer items-center justify-between rounded-md border p-2 text-sm transition-colors hover:bg-accent ${isSelected
                        ? 'border-primary/30 bg-primary/10'
                        : 'border-transparent'
                        }`}
                      onClick={() => {
                        if (selectedServices.includes(service)) {
                          setSelectedServices(selectedServices.filter(s => s !== service));
                        } else {
                          setSelectedServices([...selectedServices, service]);
                        }
                      }}
                    >
                      <div className="flex flex-1 items-center gap-2">
                        <div className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                        <span className={isSelected ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                          {service}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {totalCount > 0 && (
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary transition-all duration-500"
                              style={{ width: `${(totalCount / (allVendorsData?.total || 1)) * 100}%` }}
                            />
                          </div>
                        )}
                        <Badge
                          variant={isSelected ? 'default' : 'secondary'}
                          className="min-w-10 justify-center tabular-nums"
                        >
                          {displayCount}
                        </Badge>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Suppliers by Location */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              # Suppliers by Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <IndiaMap
                stateData={Object.fromEntries(stats.byLocation)}
                className="h-full"
                showLegend={true}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-4">
        {/* Left Sidebar - Filters */}
        <Card className="lg:col-span-1">
          <CardHeader className="border-b py-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 p-5">
            {filterGroups.map((group) => (
              <div key={group.label} className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </Label>
                <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                  {group.options.slice(0, 10).map(option => (
                    <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={group.selected.includes(option)}
                        onCheckedChange={() => { toggleFilter(group.selected, group.set, option); }}
                      />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
                <Separator />
              </div>
            ))}

            {/* City Filter */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">City</Label>
              <Select value={selectedCity || 'all'} onValueChange={setSelectedCity}>
                <SelectTrigger>
                  <SelectValue placeholder="Select city" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Cities</SelectItem>
                  {filterOptions.cities.map(city => (
                    <SelectItem key={city} value={city}>{city}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Clear Filters */}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                clearAllFilters();
                setMinBedLength('');
                setMinBedWidth('');
                setMinBedHeight('');
              }}
            >
              Clear All Filters
            </Button>
          </CardContent>
        </Card>

        {/* Right Content */}
        <div className="space-y-6 lg:col-span-3">
          {/* Search + equipment filters */}
          <Card>
            <CardContent className="space-y-5 p-5">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  placeholder="Search suppliers by name, code, or location..."
                  aria-label="Search suppliers"
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); }}
                  className="h-10 pl-10"
                />
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-semibold">Process Block</h3>
                <p className="text-xs text-muted-foreground">Filter by equipment specifications</p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Process</Label>
                  <Select value={selectedProcess || 'all'} onValueChange={setSelectedProcess}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select process" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Processes</SelectItem>
                      {filterOptions.services.map(service => (
                        <SelectItem key={service} value={service}>{service}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Equipment Type</Label>
                  <Select value={selectedEquipmentType || 'all'} onValueChange={setSelectedEquipmentType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[400px]">
                      <SelectItem value="all">All Types</SelectItem>
                      {getAllCategories().map((category) => {
                        const categoryEquipment = EQUIPMENT_TYPES.filter(eq => eq.category === category);
                        if (categoryEquipment.length === 0) return null;

                        return (
                          <div key={category}>
                            <div className="sticky top-0 bg-muted/50 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                              {category}
                            </div>
                            {categoryEquipment
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map(eq => (
                                <SelectItem key={eq.id} value={eq.name} className="pl-6">
                                  {eq.name}
                                </SelectItem>
                              ))
                            }
                          </div>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Selection Criteria */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Selection Criteria</Label>
                <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 md:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Tonnage (tons)</Label>
                    <Input
                      type="number"
                      placeholder="40"
                      value={minTonnage}
                      onChange={(e) => { setMinTonnage(e.target.value); }}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Length (mm)</Label>
                    <Input
                      type="number"
                      placeholder="1000"
                      value={minBedLength}
                      onChange={(e) => { setMinBedLength(e.target.value); }}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Width (mm)</Label>
                    <Input
                      type="number"
                      placeholder="500"
                      value={minBedWidth}
                      onChange={(e) => { setMinBedWidth(e.target.value); }}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Height (mm)</Label>
                    <Input
                      type="number"
                      placeholder="600"
                      value={minBedHeight}
                      onChange={(e) => { setMinBedHeight(e.target.value); }}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vendors Table */}
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 border-b px-6 py-4">
              <div className="space-y-0.5">
                <CardTitle className="text-base">Suppliers List</CardTitle>
                <CardDescription>
                  {hasActiveFilters
                    ? `Showing ${vendors.length} of ${total} suppliers`
                    : 'Apply search or filters to view suppliers'
                  }
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!hasActiveFilters ? (
                <EmptyState
                  icon={Search}
                  title="Use search or filters to find suppliers"
                  description="Enter a search term or select filters from the sidebar to view suppliers"
                />
              ) : isLoading ? (
                <TableSkeleton rows={6} columns={6} label="Loading suppliers..." />
              ) : vendors.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No suppliers found"
                  description="No suppliers match your filters. Try adjusting or clearing filters."
                />
              ) : (
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="px-6">Supplier</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Services</TableHead>
                      <TableHead>Equipment</TableHead>
                      <TableHead>Certifications</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-12 text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendors.map(vendor => {
                      const websiteUrl = normalizeWebsiteUrl(vendor.website);
                      return (
                        <TableRow
                          key={vendor.id}
                          className="cursor-pointer"
                          onClick={() => { router.push(`/vendors/${vendor.id}`); }}
                        >
                          <TableCell className="px-6">
                            <div className="font-medium text-foreground">{vendor.name}</div>
                            {websiteUrl && (
                              <a
                                href={websiteUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-primary hover:underline"
                                onClick={(e) => { e.stopPropagation(); }}
                              >
                                Visit website <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {vendor.supplierCode || 'N/A'}
                          </TableCell>
                          <TableCell>
                            {vendor.city && vendor.state ? (
                              <div className="flex items-center gap-1 text-sm">
                                <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span>{vendor.city}, {vendor.state}</span>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">N/A</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {vendor.process && vendor.process.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {vendor.process.slice(0, 2).map(service => (
                                  <Badge key={service} variant="outline" className="text-xs font-normal">
                                    {service}
                                  </Badge>
                                ))}
                                {vendor.process.length > 2 && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    +{vendor.process.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">None</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {vendor.equipmentCount && vendor.equipmentCount > 0 ? (
                              <div className="flex items-center gap-1 text-sm tabular-nums">
                                <Factory className="h-3 w-3 text-muted-foreground" />
                                <span>{vendor.equipmentCount}</span>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(`/vendors/${vendor.id}?tab=equipment`);
                                }}
                                className="-ml-2 gap-1 text-xs"
                              >
                                <Plus className="h-3 w-3" />
                                Add Equipment
                              </Button>
                            )}
                          </TableCell>
                          <TableCell>
                            {vendor.certifications && vendor.certifications.length > 0 ? (
                              <div className="flex items-center gap-1 text-sm">
                                <Award className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <span>{vendor.certifications.slice(0, 2).join(', ')}</span>
                                {vendor.certifications.length > 2 && <span>...</span>}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">None</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <VendorStatusBadge status={vendor.status} />
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => { e.stopPropagation(); }}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label={`Actions for ${vendor.name}`}
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => { router.push(`/vendors/${vendor.id}`); }}>
                                  View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => { router.push(`/vendors/${vendor.id}?tab=equipment`); }}>
                                  Add Equipment
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Suppliers</DialogTitle>
            <DialogDescription>
              Upload a CSV or Excel (.xlsx) file to import suppliers. Columns: Supplier Name, Full Address, Website, Company Phone, Industries Served, Process, Materials, Countries Served, Annual Turnover, Certifications, Inspection Options, QMS Metrics, QMS Procedures, Workshop/Facility, Warehouse, Packing, Logistics, Max Capacity, Avg Utilization, Shift Hours, Shifts/Day, Working Days/Wk, In-House Testing, Operators, Engineers, Prod. Managers, Contact 1, Title 1, Email 1, Phone 1, Contact 2, Title 2, Email 2, Phone 2, Company Profile, Machine List.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
                id="csv-upload"
              />
              <label
                htmlFor="csv-upload"
                className="cursor-pointer text-sm text-primary hover:underline"
              >
                Click to upload CSV or Excel file
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Supported formats: .csv, .xlsx</p>
              {selectedFile && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Selected: {selectedFile.name}
                </p>
              )}
            </div>
            <Button
              onClick={handleUploadCsv}
              disabled={!selectedFile || uploadCsvMutation.isPending}
              className="w-full"
            >
              {uploadCsvMutation.isPending ? 'Uploading...' : 'Upload File'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Vendor Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Supplier</DialogTitle>
            <DialogDescription>
              Create a new supplier entry in your database
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            {/* Basic Information */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Basic Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Supplier Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="e.g., Acme Manufacturing Co."
                    value={newVendorData.name}
                    onChange={(e) => { setNewVendorData({ ...newVendorData, name: e.target.value }); }}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Supplier Code</Label>
                  <Input
                    placeholder="e.g., SUP-001"
                    value={newVendorData.supplierCode}
                    onChange={(e) => { setNewVendorData({ ...newVendorData, supplierCode: e.target.value }); }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Status</Label>
                  <Select
                    {...(newVendorData.status !== undefined ? { value: newVendorData.status } : {})}
                    onValueChange={(value: 'active' | 'inactive' | 'pending') => { setNewVendorData({ ...newVendorData, status: value }); }
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Vendor Type</Label>
                  <Select
                    {...(newVendorData.vendorType !== undefined ? { value: newVendorData.vendorType } : {})}
                    onValueChange={(value: 'supplier' | 'oem' | 'both') => { setNewVendorData({ ...newVendorData, vendorType: value }); }
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supplier">Supplier</SelectItem>
                      <SelectItem value="oem">OEM</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Contact Information */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Website</Label>
                  <Input
                    placeholder="https://example.com"
                    value={newVendorData.website}
                    onChange={(e) => { setNewVendorData({ ...newVendorData, website: e.target.value }); }}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Email</Label>
                  <Input
                    type="email"
                    placeholder="info@company.com"
                    value={newVendorData.companyEmail}
                    onChange={(e) => { setNewVendorData({ ...newVendorData, companyEmail: e.target.value }); }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Company Phone</Label>
                <Input
                  placeholder="+91-XXXXXXXXXX"
                  value={newVendorData.companyPhone}
                  onChange={(e) => { setNewVendorData({ ...newVendorData, companyPhone: e.target.value }); }}
                />
              </div>
            </div>

            <Separator />

            {/* Industries */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Industries</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., Automotive"
                    value={industryInput}
                    onChange={(e) => { setIndustryInput(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addIndustry();
                      }
                    }}
                  />
                  <Button type="button" onClick={addIndustry} variant="outline" className="shrink-0">
                    Add
                  </Button>
                </div>
                {(newVendorData.industries ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(newVendorData.industries ?? []).map((industry) => (
                      <Badge key={industry} variant="secondary" className="gap-1">
                        {industry}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() => { removeIndustry(industry); }}
                        />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Processes */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Processes</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., CNC Machining"
                    value={processInput}
                    onChange={(e) => { setProcessInput(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addProcess();
                      }
                    }}
                  />
                  <Button type="button" onClick={addProcess} variant="outline">
                    Add
                  </Button>
                </div>
                {(newVendorData.process ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(newVendorData.process ?? []).map((process) => (
                      <Badge key={process} variant="secondary" className="gap-1">
                        {process}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() => { removeProcess(process); }}
                        />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Certifications */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Certifications</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., ISO 9001"
                    value={certificationInput}
                    onChange={(e) => { setCertificationInput(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCertification();
                      }
                    }}
                  />
                  <Button type="button" onClick={addCertification} variant="outline">
                    Add
                  </Button>
                </div>
                {(newVendorData.certifications ?? []).length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {(newVendorData.certifications ?? []).map((cert) => (
                      <Badge key={cert} variant="secondary" className="gap-1">
                        {cert}
                        <X
                          className="h-3 w-3 cursor-pointer"
                          onClick={() => { removeCertification(cert); }}
                        />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* Location */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Location</h3>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Address</Label>
                <Input
                  placeholder="e.g., 123 Industrial Ave, Business Park"
                  value={newVendorData.addresses}
                  onChange={(e) => { setNewVendorData({ ...newVendorData, addresses: e.target.value }); }}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">State / Province</Label>
                  {/* Suggestions from the vendor table, free text for anything
                      new. A fixed list cannot hold the real data — 647 vendors
                      include Chinese provinces. */}
                  <Input
                    list="vendor-state-suggestions"
                    placeholder={stateSuggestions.length ? 'Select or type a state / province' : 'Enter state / province'}
                    value={newVendorData.state ?? ''}
                    onChange={(e) => { setNewVendorData({ ...newVendorData, state: e.target.value }); }}
                  />
                  <datalist id="vendor-state-suggestions">
                    {stateSuggestions.map((state) => (
                      <option key={state} value={state} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">City</Label>
                  {/* Same contract as State above: suggest what the table
                      already contains, accept anything. The old version showed
                      a dropdown only for the 20 hardcoded states and a bare
                      text box (disabled until a state was picked) for the rest,
                      which is why a custom-city escape hatch had to exist at
                      all. It no longer does. */}
                  <Input
                    list="vendor-city-suggestions"
                    placeholder={citySuggestions.length ? 'Select or type a city' : 'Enter city'}
                    value={newVendorData.city ?? ''}
                    onChange={(e) => { setNewVendorData({ ...newVendorData, city: e.target.value }); }}
                  />
                  <datalist id="vendor-city-suggestions">
                    {citySuggestions.map((city) => (
                      <option key={city} value={city} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Country</Label>
                  <Select
                    {...(newVendorData.country !== undefined ? { value: newVendorData.country } : {})}
                    onValueChange={(value) => { setNewVendorData({ ...newVendorData, country: value }); }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="India">India</SelectItem>
                      <SelectItem value="USA">USA</SelectItem>
                      <SelectItem value="China">China</SelectItem>
                      <SelectItem value="Germany">Germany</SelectItem>
                      <SelectItem value="Japan">Japan</SelectItem>
                      <SelectItem value="United Kingdom">United Kingdom</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 border-t pt-4">
              <Button
                variant="outline"
                onClick={() => { setCreateDialogOpen(false); }}
                disabled={createVendorMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateVendor}
                disabled={createVendorMutation.isPending}
              >
                {createVendorMutation.isPending ? 'Creating...' : 'Create Supplier'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
