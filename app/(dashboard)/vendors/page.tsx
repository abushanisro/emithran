'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useVendors, useUploadVendorsCsv, useDeleteAllVendors, useCreateVendor } from '@/lib/api/hooks/useVendors';
import { Plus, Search, Upload, MapPin, Factory, Award, Filter, Trash2, ExternalLink, TrendingUp, X, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { VendorQuery, CreateVendorData } from '@/lib/api/vendors';
import dynamic from 'next/dynamic';

const IndiaMap = dynamic(() => import('@/components/ui/india-map').then(mod => ({ default: mod.IndiaMap })), { 
  ssr: false,
  loading: () => <div className="h-80 bg-muted animate-pulse rounded-md" />
});
import { useCounterAnimation } from '@/hooks/use-counter-animation';
import { EQUIPMENT_TYPES, getAllCategories } from '@/lib/constants/equipment-types';

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
  const [customCityMode, setCustomCityMode] = useState(false);

  // Build query from filters
  const query: VendorQuery = useMemo(() => {
    // Combine process filters from sidebar checkboxes and process block dropdown
    let processFilters = [...selectedServices];
    if (selectedProcess && selectedProcess !== 'all' && !processFilters.includes(selectedProcess)) {
      processFilters.push(selectedProcess);
    }

    const q: VendorQuery = {
      search: searchTerm || undefined,
      process: processFilters.length > 0 ? processFilters : undefined,
      industries: selectedIndustries.length > 0 ? selectedIndustries : undefined,
      certifications: selectedCertifications.length > 0 ? selectedCertifications : undefined,
      city: selectedCity && selectedCity !== 'all' ? selectedCity : undefined,
      equipmentType: selectedEquipmentType && selectedEquipmentType !== 'all' ? selectedEquipmentType : undefined,
      minTonnage: minTonnage ? parseFloat(minTonnage) : undefined,
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
  const hasActiveFilters = useMemo(() => {
    return !!(
      searchTerm ||
      selectedServices.length > 0 ||
      selectedIndustries.length > 0 ||
      selectedCertifications.length > 0 ||
      (selectedCity && selectedCity !== 'all') ||
      (selectedProcess && selectedProcess !== 'all') ||
      (selectedEquipmentType && selectedEquipmentType !== 'all') ||
      minTonnage
    );
  }, [searchTerm, selectedServices, selectedIndustries, selectedCertifications, selectedCity, selectedProcess, selectedEquipmentType, minTonnage]);

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

    allVendors.forEach(vendor => {
      vendor.process?.forEach(s => services.add(s));
      vendor.industries?.forEach(i => industries.add(i));
      vendor.certifications?.forEach(c => certifications.add(c));
      if (vendor.city) cities.add(vendor.city);
    });

    return {
      services: Array.from(services).sort(),
      industries: Array.from(industries).sort(),
      certifications: Array.from(certifications).sort(),
      cities: Array.from(cities).sort(),
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
        setCustomCityMode(false);
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

  // Indian States and Cities data
  const indianStates = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
    'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
    'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
    'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
  ];

  const citiesByState: Record<string, string[]> = {
    'Karnataka': ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Belagavi', 'Davangere', 'Ballari', 'Vijayapura'],
    'Maharashtra': ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Thane'],
    'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore'],
    'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar', 'Anand'],
    'Delhi': ['New Delhi', 'Central Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi'],
    'Telangana': ['Hyderabad', 'Warangal', 'Nizamabad', 'Khammam', 'Karimnagar', 'Ramagundam'],
    'Haryana': ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Hisar', 'Rohtak', 'Karnal', 'Sonipat'],
    'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Ghaziabad', 'Agra', 'Varanasi', 'Meerut', 'Allahabad', 'Noida'],
    'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Haldia'],
    'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar'],
    'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Chandigarh'],
    'Madhya Pradesh': ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Ratlam'],
    'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati'],
    'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur'],
    'Odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur'],
    'Jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Hazaribagh'],
    'Chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg'],
    'Uttarakhand': ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur'],
    'Goa': ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'],
    'Chandigarh': ['Chandigarh'],
  };

  const availableCities = useMemo(() => {
    const list = newVendorData.state ? citiesByState[newVendorData.state] : undefined;
    return list ?? [];
  }, [newVendorData.state]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Supplier Database</h1>
            <p className="text-muted-foreground mt-1">
              Comprehensive vendor management and filtering
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => setUploadDialogOpen(true)}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            Import File
          </Button>
          <Button
            variant="outline"
            onClick={handleDeleteAll}
            disabled={totalAllVendors === 0 || deleteAllMutation.isPending}
            className="gap-2 text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-4 w-4" />
            Delete All
          </Button>
          <Button
            className="gap-2"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Supplier
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        {/* Total Suppliers */}
        <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={() => {
          setSearchTerm('');
          setSelectedServices([]);
          setSelectedIndustries([]);
          setSelectedCertifications([]);
          setSelectedCity('all');
          setSelectedProcess('all');
          setSelectedEquipmentType('all');
          setMinTonnage('');
        }}>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-4">
              {/* Animated Total Count */}
              <div className="relative mb-2">
                <div
                  className="text-5xl font-bold text-primary mb-1 transition-all duration-300 animate-in fade-in zoom-in"
                  style={{
                    animationDuration: '0.5s',
                    transform: animatedTotal === total ? 'scale(1)' : 'scale(0.95)',
                  }}
                >
                  {animatedTotal.toLocaleString()}
                </div>
                {!isLoading && animatedTotal < total && (
                  <div className="absolute -top-2 -right-8 animate-in slide-in-from-bottom-2 fade-in">
                    <TrendingUp className="h-5 w-5 text-green-500 animate-pulse" />
                  </div>
                )}
              </div>
              <div className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-1">
                <Factory className="h-3 w-3" />
                Total Suppliers
              </div>

              {/* Status Breakdown */}
              <div className="w-full space-y-3 border-t pt-4">
                {/* Progress Bar */}
                {totalAllVendors > 0 && (
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-green-400 to-green-600 transition-all duration-1000 ease-out"
                      style={{
                        width: `${(activeCount / totalAllVendors) * 100}%`,
                      }}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm group hover:bg-green-50/50 p-1 rounded transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                      <span className="text-muted-foreground">Active</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {totalAllVendors > 0 ? Math.round((activeCount / totalAllVendors) * 100) : 0}%
                      </span>
                      <Badge variant="secondary" className="bg-green-50 text-green-700 hover:bg-green-100 transition-all duration-300">
                        {animatedActive}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-between items-center text-sm group hover:bg-gray-50 p-1 rounded transition-colors">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                      <span className="text-muted-foreground">Inactive</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {totalAllVendors > 0 ? Math.round((inactiveCount / totalAllVendors) * 100) : 0}%
                      </span>
                      <Badge variant="secondary" className="bg-gray-50 text-gray-600 hover:bg-gray-100 transition-all duration-300">
                        {animatedInactive}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Action */}
              <Button
                variant="ghost"
                size="sm"
                className="mt-4 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchTerm('');
                  setSelectedServices([]);
                  setSelectedIndustries([]);
                  setSelectedCertifications([]);
                  setSelectedCity('all');
                  setSelectedProcess('all');
                  setSelectedEquipmentType('all');
                  setMinTonnage('');
                }}
              >
                View All Suppliers
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Suppliers by Service */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Factory className="h-4 w-4" />
                # Suppliers by Service
              </div>
              <Badge variant="outline" className="text-xs">
                {filterOptions.services.length} Services
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
              {filterOptions.services.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No services found
                </div>
              ) : (
                filterOptions.services.map((service) => {
                  const totalCount = allVendors.filter(v => v.process?.includes(service)).length;
                  const filteredCount = vendors.filter(v => v.process?.includes(service)).length;
                  const isSelected = selectedServices.includes(service) || selectedProcess === service;
                  const displayCount = hasActiveFilters ? filteredCount : totalCount;

                  return (
                    <div
                      key={service}
                      className={`flex justify-between items-center text-sm p-2 rounded-md cursor-pointer transition-all hover:bg-primary/5 border ${isSelected
                        ? 'bg-primary/10 border-primary/30'
                        : 'border-transparent hover:border-primary/20'
                        }`}
                      onClick={() => {
                        if (selectedServices.includes(service)) {
                          setSelectedServices(selectedServices.filter(s => s !== service));
                        } else {
                          setSelectedServices([...selectedServices, service]);
                        }
                      }}
                    >
                      <div className="flex items-center gap-2 flex-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-primary' : 'bg-muted-foreground/30'
                          }`} />
                        <span className={`text-sm ${isSelected ? 'font-medium text-foreground' : 'text-muted-foreground'
                          }`}>
                          {service}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Progress indicator */}
                        {totalCount > 0 && (
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary transition-all duration-500"
                              style={{
                                width: `${(totalCount / (allVendorsData?.total || 1)) * 100}%`,
                              }}
                            />
                          </div>
                        )}
                        <Badge
                          variant={isSelected ? "default" : "secondary"}
                          className="min-w-[40px] justify-center"
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
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              # Suppliers by Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
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
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Sidebar - Filters */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Services Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Services</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {filterOptions.services.slice(0, 10).map(service => (
                  <label key={service} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedServices.includes(service)}
                      onChange={() => toggleFilter(selectedServices, setSelectedServices, service)}
                      className="rounded"
                    />
                    <span className="text-sm">{service}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Industry Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Industry</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {filterOptions.industries.slice(0, 10).map(industry => (
                  <label key={industry} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIndustries.includes(industry)}
                      onChange={() => toggleFilter(selectedIndustries, setSelectedIndustries, industry)}
                      className="rounded"
                    />
                    <span className="text-sm">{industry}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* Certification Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Certification</label>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {filterOptions.certifications.slice(0, 10).map(cert => (
                  <label key={cert} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedCertifications.includes(cert)}
                      onChange={() => toggleFilter(selectedCertifications, setSelectedCertifications, cert)}
                      className="rounded"
                    />
                    <span className="text-sm">{cert}</span>
                  </label>
                ))}
              </div>
            </div>

            <Separator />

            {/* City Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">City</label>
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
                setSelectedServices([]);
                setSelectedIndustries([]);
                setSelectedCertifications([]);
                setSelectedCity('all');
                setSelectedProcess('all');
                setSelectedEquipmentType('all');
                setSearchTerm('');
                setMinTonnage('');
                setMinBedLength('');
                setMinBedWidth('');
                setMinBedHeight('');
              }}
            >
              Clear All Filters
            </Button>
          </CardContent>
        </Card>

        {/* Right Content - Vendors List & Process Block */}
        <div className="lg:col-span-3 space-y-6">
          {/* Search Bar */}
          <Card>
            <CardContent className="pt-6">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search suppliers by name, code, or location..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </CardContent>
          </Card>

          {/* Process Block */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Process Block</CardTitle>
              <CardDescription>Filter by equipment specifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Process</label>
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
                  <label className="text-sm font-medium">Equipment Type</label>
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
                            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50 sticky top-0">
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

              <Separator />

              {/* Selection Criteria */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">Selection Criteria</label>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 p-3 border rounded-md bg-muted/30">
                  {/* Tonnage */}
                  <div>
                    <label className="text-xs text-muted-foreground">Tonnage (tons)</label>
                    <Input
                      type="number"
                      placeholder="40"
                      value={minTonnage}
                      onChange={(e) => setMinTonnage(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>

                  {/* Bed Size - Length */}
                  <div>
                    <label className="text-xs text-muted-foreground">Length (mm)</label>
                    <Input
                      type="number"
                      placeholder="1000"
                      value={minBedLength}
                      onChange={(e) => setMinBedLength(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>

                  {/* Bed Size - Width */}
                  <div>
                    <label className="text-xs text-muted-foreground">Width (mm)</label>
                    <Input
                      type="number"
                      placeholder="500"
                      value={minBedWidth}
                      onChange={(e) => setMinBedWidth(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>

                  {/* Bed Size - Height */}
                  <div>
                    <label className="text-xs text-muted-foreground">Height (mm)</label>
                    <Input
                      type="number"
                      placeholder="600"
                      value={minBedHeight}
                      onChange={(e) => setMinBedHeight(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Vendors Table */}
          <Card>
            <CardHeader>
              <CardTitle>Suppliers List</CardTitle>
              <CardDescription>
                {hasActiveFilters
                  ? `Showing ${vendors.length} of ${total} suppliers`
                  : 'Apply search or filters to view suppliers'
                }
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!hasActiveFilters ? (
                <div className="text-center py-12 space-y-3">
                  <div className="flex justify-center">
                    <Search className="h-16 w-16 text-muted-foreground/50" />
                  </div>
                  <div className="text-muted-foreground">
                    <p className="font-medium mb-1">Use search or filters to find suppliers</p>
                    <p className="text-sm">Enter a search term or select filters from the sidebar to view suppliers</p>
                  </div>
                </div>
              ) : isLoading ? (
                <div className="text-center py-12 text-muted-foreground">
                  Loading suppliers...
                </div>
              ) : vendors.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No suppliers found matching your filters. Try adjusting or clearing filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-3 px-4 font-medium">Supplier Name</th>
                        <th className="text-left py-3 px-4 font-medium">Code</th>
                        <th className="text-left py-3 px-4 font-medium">Location</th>
                        <th className="text-left py-3 px-4 font-medium">Services</th>
                        <th className="text-left py-3 px-4 font-medium">Equipment</th>
                        <th className="text-left py-3 px-4 font-medium">Certifications</th>
                        <th className="text-left py-3 px-4 font-medium">Status</th>
                        <th className="text-left py-3 px-4 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendors.map(vendor => (
                        <tr
                          key={vendor.id}
                          className="border-b hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer"
                          onClick={() => router.push(`/vendors/${vendor.id}`)}
                        >
                          <td className="py-3 px-4">
                            <div className="font-medium">{vendor.name}</div>
                            {vendor.website && (
                              <a
                                href={vendor.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                Visit website <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </td>
                          <td className="py-3 px-4 text-sm text-muted-foreground">
                            {vendor.supplierCode || 'N/A'}
                          </td>
                          <td className="py-3 px-4">
                            {vendor.city && vendor.state ? (
                              <div className="flex items-center gap-1 text-sm">
                                <MapPin className="h-3 w-3 text-muted-foreground" />
                                <span>{vendor.city}, {vendor.state}</span>
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">N/A</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {vendor.process && vendor.process.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {vendor.process.slice(0, 2).map(service => (
                                  <Badge key={service} variant="outline" className="text-xs">
                                    {service}
                                  </Badge>
                                ))}
                                {vendor.process.length > 2 && (
                                  <Badge variant="outline" className="text-xs">
                                    +{vendor.process.length - 2}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">None</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {vendor.equipmentCount && vendor.equipmentCount > 0 ? (
                              <div className="flex items-center gap-1 text-sm">
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
                                className="gap-1 text-xs"
                              >
                                <Plus className="h-3 w-3" />
                                Add Equipment
                              </Button>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {vendor.certifications && vendor.certifications.length > 0 ? (
                              <div className="flex items-center gap-1 text-sm">
                                <Award className="h-3 w-3 text-muted-foreground" />
                                <span>{vendor.certifications.slice(0, 2).join(', ')}</span>
                                {vendor.certifications.length > 2 && <span>...</span>}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">None</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant={vendor.status === 'active' ? 'default' : 'secondary'}>
                              {vendor.status}
                            </Badge>
                          </td>
                          <td className="py-3 px-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/vendors/${vendor.id}`);
                              }}
                              className="gap-1"
                            >
                              View Details
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
              <h3 className="text-sm font-semibold">Basic Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Supplier Name <span className="text-red-500">*</span>
                  </label>
                  <Input
                    placeholder="e.g., Acme Manufacturing Co."
                    value={newVendorData.name}
                    onChange={(e) => setNewVendorData({ ...newVendorData, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Supplier Code</label>
                  <Input
                    placeholder="e.g., SUP-001"
                    value={newVendorData.supplierCode}
                    onChange={(e) => setNewVendorData({ ...newVendorData, supplierCode: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Status</label>
                  <Select
                    value={newVendorData.status}
                    onValueChange={(value: 'active' | 'inactive' | 'pending') =>
                      setNewVendorData({ ...newVendorData, status: value })
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
                  <label className="text-sm font-medium">Vendor Type</label>
                  <Select
                    value={newVendorData.vendorType}
                    onValueChange={(value: 'supplier' | 'oem' | 'both') =>
                      setNewVendorData({ ...newVendorData, vendorType: value })
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
              <h3 className="text-sm font-semibold">Contact Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Website</label>
                  <Input
                    placeholder="https://example.com"
                    value={newVendorData.website}
                    onChange={(e) => setNewVendorData({ ...newVendorData, website: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Email</label>
                  <Input
                    type="email"
                    placeholder="info@company.com"
                    value={newVendorData.companyEmail}
                    onChange={(e) => setNewVendorData({ ...newVendorData, companyEmail: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Company Phone</label>
                <Input
                  placeholder="+91-XXXXXXXXXX"
                  value={newVendorData.companyPhone}
                  onChange={(e) => setNewVendorData({ ...newVendorData, companyPhone: e.target.value })}
                />
              </div>
            </div>

            <Separator />

            {/* Industries */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Industries</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., Automotive"
                    value={industryInput}
                    onChange={(e) => setIndustryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addIndustry();
                      }
                    }}
                  />
                  <Button type="button" onClick={addIndustry} variant="outline">
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
                          onClick={() => removeIndustry(industry)}
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
              <h3 className="text-sm font-semibold">Processes</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., CNC Machining"
                    value={processInput}
                    onChange={(e) => setProcessInput(e.target.value)}
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
                          onClick={() => removeProcess(process)}
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
              <h3 className="text-sm font-semibold">Certifications</h3>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g., ISO 9001"
                    value={certificationInput}
                    onChange={(e) => setCertificationInput(e.target.value)}
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
                          onClick={() => removeCertification(cert)}
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
              <h3 className="text-sm font-semibold">Location</h3>
              <div className="space-y-2">
                <label className="text-sm font-medium">Address</label>
                <Input
                  placeholder="e.g., 123 Industrial Ave, Business Park"
                  value={newVendorData.addresses}
                  onChange={(e) => setNewVendorData({ ...newVendorData, addresses: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">State</label>
                  <Select
                    value={newVendorData.state}
                    onValueChange={(value) => {
                      setNewVendorData({ ...newVendorData, state: value, city: '' });
                      setCustomCityMode(false);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {indianStates.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">City</label>
                  {availableCities.length > 0 ? (
                    <>
                      {!customCityMode ? (
                        <Select
                          value={newVendorData.city}
                          onValueChange={(value) => {
                            if (value === 'custom') {
                              setCustomCityMode(true);
                              setNewVendorData({ ...newVendorData, city: '' });
                            } else {
                              setNewVendorData({ ...newVendorData, city: value });
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select city" />
                          </SelectTrigger>
                          <SelectContent className="max-h-[200px]">
                            {availableCities.map((city) => (
                              <SelectItem key={city} value={city}>
                                {city}
                              </SelectItem>
                            ))}
                            <SelectItem value="custom">
                              <span className="text-muted-foreground italic">+ Enter custom city</span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex gap-2">
                          <Input
                            placeholder="Enter city name"
                            value={newVendorData.city}
                            onChange={(e) => setNewVendorData({ ...newVendorData, city: e.target.value })}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setCustomCityMode(false);
                              setNewVendorData({ ...newVendorData, city: '' });
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <Input
                      placeholder={newVendorData.state ? "Enter city name" : "Select state first"}
                      value={newVendorData.city}
                      onChange={(e) => setNewVendorData({ ...newVendorData, city: e.target.value })}
                      disabled={!newVendorData.state}
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Country</label>
                  <Select
                    value={newVendorData.country}
                    onValueChange={(value) => setNewVendorData({ ...newVendorData, country: value })}
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
            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
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
