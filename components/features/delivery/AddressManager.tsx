'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Plus,
  MapPin,
  Edit,
  Trash2,
  Phone,
  Mail,
  Building,
  Star,
  CheckCircle,
  Navigation,
} from 'lucide-react';
import {
  DeliveryAddress,
  useDeliveryAddresses,
  useCreateDeliveryAddress
} from '@/lib/api/hooks/useDelivery';
import { toast } from 'sonner';

interface AddressManagerProps {
  projectId: string;
  onAddressSelect?: (address: DeliveryAddress) => void;
  selectedAddressId?: string;
}

export default function AddressManager({ 
  projectId, 
  onAddressSelect,
  selectedAddressId 
}: AddressManagerProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<Partial<DeliveryAddress>>({
    projectId,
    addressType: 'delivery',
    contactPerson: '',
    contactPhone: '',
    contactEmail: '',
    companyName: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    stateProvince: '',
    postalCode: '',
    country: 'India',
    specialInstructions: '',
    isDefault: false
  });

  const { data: addresses = [], isLoading, refetch } = useDeliveryAddresses(projectId);
  const createAddressMutation = useCreateDeliveryAddress();

  // Indian states for better UX
  const indianStates = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
    'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
    'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
    'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
    'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Ladakh'
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await createAddressMutation.mutateAsync(formData as DeliveryAddress);
      setIsDialogOpen(false);
      resetForm();
      refetch();
      toast.success('Address created successfully');
    } catch (error) {
      console.error('Failed to create address:', error);
      toast.error('Failed to create address');
    }
  };

  const resetForm = () => {
    setFormData({
      projectId,
      addressType: 'delivery',
      contactPerson: '',
      contactPhone: '',
      contactEmail: '',
      companyName: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      stateProvince: '',
      postalCode: '',
      country: 'India',
      specialInstructions: '',
      isDefault: false
    });
  };

  const filteredAddresses = addresses.filter(address => 
    address.contactPerson?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    address.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    address.city?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    address.addressLine1?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const validatePincode = (pincode: string) => {
    const pincodeRegex = /^[1-9][0-9]{5}$/;
    return pincodeRegex.test(pincode);
  };

  const validatePhone = (phone: string) => {
    const phoneRegex = /^[6-9]\d{9}$/;
    return phoneRegex.test(phone.replace(/\D/g, ''));
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Delivery Addresses</h2>
          <p className="text-muted-foreground">
            Manage delivery locations for your project
          </p>
        </div>
        
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Address
            </Button>
          </DialogTrigger>
          
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Delivery Address</DialogTitle>
              <DialogDescription>
                Create a new delivery address with complete contact information and location details.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Contact Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Contact Information</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="companyName">Company Name</Label>
                    <Input
                      id="companyName"
                      value={formData.companyName || ''}
                      onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                      placeholder="Enter company name"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="contactPerson">Contact Person *</Label>
                    <Input
                      id="contactPerson"
                      required
                      value={formData.contactPerson || ''}
                      onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                      placeholder="Enter contact person name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="contactPhone">Phone Number</Label>
                    <Input
                      id="contactPhone"
                      type="tel"
                      value={formData.contactPhone || ''}
                      onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                      placeholder="+91 98765 43210"
                      className={!validatePhone(formData.contactPhone || '') && formData.contactPhone ? 'border-red-300' : ''}
                    />
                    {!validatePhone(formData.contactPhone || '') && formData.contactPhone && (
                      <p className="text-sm text-red-600 mt-1">Please enter a valid Indian phone number</p>
                    )}
                  </div>
                  
                  <div>
                    <Label htmlFor="contactEmail">Email Address</Label>
                    <Input
                      id="contactEmail"
                      type="email"
                      value={formData.contactEmail || ''}
                      onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                      placeholder="contact@company.com"
                    />
                  </div>
                </div>
              </div>

              {/* Address Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Address Information</h3>
                
                <div>
                  <Label htmlFor="addressLine1">Address Line 1 *</Label>
                  <Input
                    id="addressLine1"
                    required
                    value={formData.addressLine1 || ''}
                    onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                    placeholder="Building number, street name"
                  />
                </div>
                
                <div>
                  <Label htmlFor="addressLine2">Address Line 2</Label>
                  <Input
                    id="addressLine2"
                    value={formData.addressLine2 || ''}
                    onChange={(e) => setFormData({ ...formData, addressLine2: e.target.value })}
                    placeholder="Landmark, area (optional)"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="city">City *</Label>
                    <Input
                      id="city"
                      required
                      value={formData.city || ''}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      placeholder="Enter city"
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="stateProvince">State *</Label>
                    <Select 
                      value={formData.stateProvince || ''} 
                      onValueChange={(value) => setFormData({ ...formData, stateProvince: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select state" />
                      </SelectTrigger>
                      <SelectContent className="z-[100]">
                        {indianStates.map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <Label htmlFor="postalCode">PIN Code *</Label>
                    <Input
                      id="postalCode"
                      required
                      value={formData.postalCode || ''}
                      onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                      placeholder="110001"
                      maxLength={6}
                      className={!validatePincode(formData.postalCode || '') && formData.postalCode ? 'border-red-300' : ''}
                    />
                    {!validatePincode(formData.postalCode || '') && formData.postalCode && (
                      <p className="text-sm text-red-600 mt-1">Please enter a valid 6-digit PIN code</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Special Instructions */}
              <div>
                <Label htmlFor="specialInstructions">Delivery Instructions</Label>
                <Textarea
                  id="specialInstructions"
                  value={formData.specialInstructions || ''}
                  onChange={(e) => setFormData({ ...formData, specialInstructions: e.target.value })}
                  placeholder="Special delivery instructions, gate codes, preferred delivery times..."
                  rows={3}
                />
              </div>

              {/* Address Type */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="addressType">Address Type</Label>
                  <Select 
                    value={formData.addressType || 'delivery'} 
                    onValueChange={(value) => setFormData({ ...formData, addressType: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      <SelectItem value="delivery">Delivery</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center space-x-2 mt-6">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={formData.isDefault || false}
                    onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="isDefault" className="text-sm">
                    Set as default address
                  </Label>
                </div>
              </div>

              <DialogFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setIsDialogOpen(false)}
                  disabled={createAddressMutation.isPending}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={
                    createAddressMutation.isPending ||
                    !formData.contactPerson ||
                    !formData.addressLine1 ||
                    !formData.city ||
                    !formData.stateProvince ||
                    !formData.postalCode ||
                    !validatePincode(formData.postalCode || '') ||
                    (formData.contactPhone && !validatePhone(formData.contactPhone))
                  }
                >
                  {createAddressMutation.isPending ? 'Creating...' : 'Create Address'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <Input
            placeholder="Search addresses by contact, company, city..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Address List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-6">
                <div className="h-4 bg-gray-200 rounded mb-2"></div>
                <div className="h-3 bg-gray-200 rounded mb-1"></div>
                <div className="h-3 bg-gray-200 rounded"></div>
              </CardContent>
            </Card>
          ))
        ) : filteredAddresses.length === 0 ? (
          <div className="col-span-full">
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <MapPin className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No addresses found</h3>
                <p className="text-muted-foreground mb-4">
                  {searchTerm ? 'No addresses match your search.' : 'Add your first delivery address to get started.'}
                </p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Address
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          filteredAddresses.map((address) => (
            <Card 
              key={address.id} 
              className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                selectedAddressId === address.id ? 'ring-2 ring-primary bg-primary/5' : ''
              }`}
              onClick={() => onAddressSelect?.(address)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {address.isDefault && (
                        <Star className="h-4 w-4 text-yellow-500 fill-current" />
                      )}
                      {address.companyName || address.contactPerson}
                    </CardTitle>
                    {address.companyName && (
                      <p className="text-sm text-muted-foreground">{address.contactPerson}</p>
                    )}
                  </div>
                  <Badge variant={address.addressType === 'delivery' ? 'default' : 'secondary'}>
                    {address.addressType}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="pt-0">
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="text-sm">
                      <div>{address.addressLine1}</div>
                      {address.addressLine2 && <div>{address.addressLine2}</div>}
                      <div>{address.city}, {address.stateProvince} {address.postalCode}</div>
                    </div>
                  </div>

                  {address.contactPhone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{address.contactPhone}</span>
                    </div>
                  )}

                  {address.contactEmail && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{address.contactEmail}</span>
                    </div>
                  )}

                  {address.specialInstructions && (
                    <div className="mt-3 p-2 bg-muted/50 rounded text-xs">
                      <strong>Instructions:</strong> {address.specialInstructions}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2">
                    {selectedAddressId === address.id && (
                      <CheckCircle className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost">
                      <Navigation className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}