'use client';
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search, MapPin, Users, Award, Building2, Filter } from 'lucide-react';
import type { Vendor } from '@/lib/api/vendors';

interface VendorSelectionCardProps {
  vendors: Vendor[];
  selectedVendorIds: string[];
  onVendorToggle: (vendorId: string, selected: boolean) => void;
  isLoading?: boolean;
  processes?: string[];
  showGrouping?: boolean;
  bomPartsSelected?: boolean;
}

export function VendorSelectionCard({
  vendors,
  selectedVendorIds,
  onVendorToggle,
  isLoading = false,
  processes = [],
  showGrouping = false,
  bomPartsSelected = false
}: VendorSelectionCardProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLocation, setSelectedLocation] = useState<string>('all');
  const [selectedCapability, setSelectedCapability] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'all' | 'groups'>('all');

  // Get unique locations and capabilities for filtering
  const locations = useMemo(() => {
    const locationSet = new Set<string>();
    vendors.forEach(vendor => {
      if (vendor.city && vendor.state) {
        locationSet.add(`${vendor.city}, ${vendor.state}`);
      }
    });
    return Array.from(locationSet).sort();
  }, [vendors]);

  const capabilities = useMemo(() => {
    const capabilitySet = new Set<string>();
    vendors.forEach(vendor => {
      vendor.process?.forEach((process: string) => capabilitySet.add(process));
    });
    return Array.from(capabilitySet).sort();
  }, [vendors]);

  // Filter vendors based on search and filters
  const filteredVendors = useMemo(() => {
    let filtered = vendors;

    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(vendor =>
        vendor.name?.toLowerCase().includes(search) ||
        vendor.city?.toLowerCase().includes(search) ||
        vendor.state?.toLowerCase().includes(search) ||
        vendor.process?.some((process: string) => process.toLowerCase().includes(search)) ||
        vendor.industries?.some((industry: string) => industry.toLowerCase().includes(search))
      );
    }

    // Location filter
    if (selectedLocation !== 'all') {
      filtered = filtered.filter(vendor => 
        vendor.city && vendor.state && 
        `${vendor.city}, ${vendor.state}` === selectedLocation
      );
    }

    // Capability filter
    if (selectedCapability !== 'all') {
      filtered = filtered.filter(vendor =>
        vendor.process?.includes(selectedCapability)
      );
    }

    return filtered;
  }, [vendors, searchTerm, selectedLocation, selectedCapability]);

  // Group vendors by location for grouping view
  const vendorGroups = useMemo(() => {
    const groups: Record<string, Vendor[]> = {};
    filteredVendors.forEach(vendor => {
      const location = vendor.city && vendor.state ? `${vendor.city}, ${vendor.state}` : 'Unknown Location';
      if (!groups[location]) {
        groups[location] = [];
      }
      groups[location].push(vendor);
    });
    return groups;
  }, [filteredVendors]);

  const selectedCount = selectedVendorIds.length;

  if (isLoading) {
    return (
      <Card className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <CardHeader className="flex flex-col space-y-1.5 p-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-bold">
              2
            </div>
            <CardTitle className="tracking-tight text-lg font-semibold text-gray-700">
              SELECT VENDOR
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <div className="flex items-center justify-center py-8">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <CardHeader className="flex flex-col space-y-1.5 p-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-bold">
            2
          </div>
          <div className="flex-1">
            <CardTitle className="tracking-tight text-lg font-semibold text-gray-700">
              SELECT VENDOR
            </CardTitle>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm text-teal-600 font-medium">
                {filteredVendors.length} vendors matched
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 pt-0">
        {/* Enhanced Search and Filter Controls */}
        <div className="space-y-4 mb-6">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search vendors by name, location, or capability..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Filters Row */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex gap-2 flex-1">
              <Select value={selectedLocation} onValueChange={setSelectedLocation}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All Locations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Locations</SelectItem>
                  {locations.map(location => (
                    <SelectItem key={location} value={location}>{location}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedCapability} onValueChange={setSelectedCapability}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All Capabilities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Capabilities</SelectItem>
                  {capabilities.map(capability => (
                    <SelectItem key={capability} value={capability}>{capability}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* View Mode Toggle */}
            {showGrouping && (
              <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'all' | 'groups')} className="w-full sm:w-auto">
                <TabsList>
                  <TabsTrigger value="all" className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    All Vendors
                  </TabsTrigger>
                  <TabsTrigger value="groups" className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    By Location
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>

          {/* Results Summary */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {filteredVendors.length} of {vendors.length} vendors
              {selectedCount > 0 && ` • ${selectedCount} selected`}
            </span>
            {(selectedLocation !== 'all' || selectedCapability !== 'all') && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setSelectedLocation('all');
                  setSelectedCapability('all');
                }}
                className="text-teal-600 hover:text-teal-700"
              >
                <Filter className="h-3 w-3 mr-1" />
                Clear Filters
              </Button>
            )}
          </div>
        </div>

        {/* Vendor Display */}
        <div className="max-h-96 overflow-y-auto">
          {filteredVendors.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <h3 className="font-medium mb-2">No vendors found</h3>
              <p className="text-sm">
                {searchTerm || selectedLocation !== 'all' || selectedCapability !== 'all' 
                  ? 'Try adjusting your filters or search terms'
                  : 'No vendors available'}
              </p>
            </div>
          ) : viewMode === 'groups' ? (
            <div className="space-y-6">
              {Object.entries(vendorGroups).map(([location, groupVendors]) => (
                <div key={location} className="space-y-4">
                  <div className="flex items-center gap-3 pb-2 border-b">
                    <MapPin className="h-5 w-5 text-teal-600" />
                    <h3 className="font-semibold text-gray-900">{location}</h3>
                    <Badge variant="outline" className="text-xs">
                      {groupVendors.length} vendor{groupVendors.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  <div className="space-y-3 pl-6">
                    {groupVendors.map((vendor) => (
                      <VendorCard 
                        key={vendor.id}
                        vendor={vendor}
                        isSelected={selectedVendorIds.includes(vendor.id)}
                        onToggle={onVendorToggle}
                        processes={processes}
                        compact={true}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredVendors.map((vendor) => (
                <VendorCard 
                  key={vendor.id}
                  vendor={vendor}
                  isSelected={selectedVendorIds.includes(vendor.id)}
                  onToggle={onVendorToggle}
                  processes={processes}
                  compact={false}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {filteredVendors.length > 0 && (
          <div className="bg-gray-50 p-3 text-sm text-muted-foreground text-center mt-4 rounded">
            {viewMode === 'groups' 
              ? `${Object.keys(vendorGroups).length} locations • ${filteredVendors.length} total vendors`
              : `Showing ${filteredVendors.length} of ${vendors.length} vendors`}
            {bomPartsSelected && (
              <span className="ml-2 text-teal-600">
                • BOM parts selected for matching
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface VendorCardProps {
  vendor: Vendor;
  isSelected: boolean;
  onToggle: (vendorId: string, selected: boolean) => void;
  processes: string[];
  compact?: boolean;
}

function VendorCard({ vendor, isSelected, onToggle, processes, compact = false }: VendorCardProps) {
  const isActive = vendor.status === 'active';
  const primaryContact = vendor.primaryContacts?.[0];

  return (
    <div
      className={`border rounded-lg overflow-hidden cursor-pointer transition-all duration-200 ${
        isSelected 
          ? 'border-teal-300 bg-teal-50 shadow-md' 
          : isActive 
            ? 'border-gray-200 hover:border-teal-200 hover:shadow-sm bg-white' 
            : 'border-gray-200 bg-gray-50 opacity-75'
      } ${compact ? 'text-sm' : ''}`}
      onClick={() => isActive && onToggle(vendor.id, !isSelected)}
    >
      {/* Vendor Header */}
      <div className={`p-4 border-b bg-white ${compact ? 'p-3' : ''}`}>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h3 className={`font-semibold text-gray-900 truncate ${compact ? 'text-sm' : 'text-lg'}`}>
                {vendor.name}
              </h3>
              <Badge 
                variant={isActive ? "default" : "secondary"}
                className={`text-xs ${isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
              >
                {isActive ? 'active' : 'inactive'}
              </Badge>
              {vendor.supplierCode && (
                <Badge variant="outline" className="text-xs">
                  {vendor.supplierCode}
                </Badge>
              )}
            </div>
            
            <div className={`flex items-center gap-4 mt-2 text-gray-600 ${compact ? 'text-xs' : 'text-sm'}`}>
              {vendor.city && vendor.state && (
                <div className="flex items-center gap-1">
                  <MapPin className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
                  <span>{vendor.city}, {vendor.state}</span>
                </div>
              )}
              
            </div>
          </div>
          
          <div className="flex flex-col items-end gap-2">
            {isSelected && (
              <div className={`rounded-full bg-teal-600 flex items-center justify-center ${compact ? 'w-5 h-5' : 'w-6 h-6'}`}>
                <svg className={`text-white ${compact ? 'w-3 h-3' : 'w-4 h-4'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
            )}
          </div>
        </div>
      </div>

      {!compact && (
        <>
          {/* Vendor Details */}
          <div className="p-4 space-y-3">
            {/* Contact Information */}
            {(primaryContact?.name || vendor.companyEmail || vendor.companyPhone) && (
              <div className="text-sm">
                <h4 className="font-medium text-gray-900 mb-1">CONTACT</h4>
                <div className="text-gray-600 space-y-1">
                  {primaryContact?.name && (
                    <div>{primaryContact.name}</div>
                  )}
                  <div className="flex flex-col sm:flex-row sm:gap-4">
                    {vendor.companyEmail && (
                      <div>{vendor.companyEmail}</div>
                    )}
                    {vendor.companyPhone && (
                      <div>{vendor.companyPhone}</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Capabilities */}
              {vendor.process && vendor.process.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2 text-sm">CAPABILITIES</h4>
                  <div className="flex flex-wrap gap-1">
                    {vendor.process.slice(0, 3).map((process: string) => (
                      <Badge
                        key={process}
                        className={`text-xs ${
                          processes.includes(process)
                            ? 'bg-teal-500 text-white'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {process}
                      </Badge>
                    ))}
                    {vendor.process.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{vendor.process.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}

              {/* Certifications */}
              {vendor.certifications && vendor.certifications.length > 0 && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-2 text-sm flex items-center gap-1">
                    <Award className="h-4 w-4" />
                    CERTIFICATIONS
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {vendor.certifications.slice(0, 2).map((cert: string) => (
                      <Badge key={cert} variant="outline" className="text-xs">
                        {cert}
                      </Badge>
                    ))}
                    {vendor.certifications.length > 2 && (
                      <Badge variant="outline" className="text-xs">
                        +{vendor.certifications.length - 2} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
      
      {compact && vendor.process && vendor.process.length > 0 && (
        <div className="px-3 pb-3">
          <div className="flex flex-wrap gap-1">
            {vendor.process.slice(0, 2).map((process: string) => (
              <Badge
                key={process}
                className={`text-xs ${
                  processes.includes(process)
                    ? 'bg-teal-500 text-white'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {process}
              </Badge>
            ))}
            {vendor.process.length > 2 && (
              <Badge variant="outline" className="text-xs">
                +{vendor.process.length - 2}
              </Badge>
            )}
          </div>
        </div>
      )}
    </div>
  );
}