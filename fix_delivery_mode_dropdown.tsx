// Add this to your delivery form to create cascading dropdowns
// Replace the existing "Carrier & Handling" section in your form

// 1. First add delivery mode state
const [deliveryMode, setDeliveryMode] = useState<string>('');

// 2. Define delivery modes with their available carriers
const deliveryModes = [
  {
    value: 'express',
    label: 'Express Delivery',
    description: 'Next day delivery',
    carriers: ['fedex', 'dhl', 'ups']
  },
  {
    value: 'standard',
    label: 'Standard Delivery',
    description: '3-5 business days',
    carriers: ['fedex', 'dhl', 'ups', 'india_post', 'dtdc']
  },
  {
    value: 'economy',
    label: 'Economy Delivery',
    description: '5-7 business days',
    carriers: ['india_post', 'dtdc', 'professional']
  },
  {
    value: 'freight',
    label: 'Freight/Heavy',
    description: 'Large shipments',
    carriers: ['logistics_plus', 'cargo_express']
  }
];

// 3. Filter carriers based on selected delivery mode
const getAvailableCarriers = () => {
  if (!deliveryMode) return [];
  
  const selectedMode = deliveryModes.find(mode => mode.value === deliveryMode);
  if (!selectedMode) return [];
  
  return carriers.filter(carrier => 
    selectedMode.carriers.includes(carrier.code) || 
    selectedMode.carriers.includes(carrier.name.toLowerCase().replace(/\s+/g, '_'))
  );
};

// 4. Reset carrier selection when delivery mode changes
const handleDeliveryModeChange = (newMode: string) => {
  setDeliveryMode(newMode);
  // Reset carrier when mode changes
  setFormData({ ...formData, carrierId: '' });
};

// 5. Replace the "Carrier & Handling" section with this:
<div>
  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
    Delivery & Handling
  </h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {/* Delivery Mode Dropdown */}
    <div>
      <Label htmlFor="deliveryMode">Delivery Mode *</Label>
      <Select value={deliveryMode} onValueChange={handleDeliveryModeChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select delivery mode" />
        </SelectTrigger>
        <SelectContent>
          {deliveryModes.map((mode) => (
            <SelectItem key={mode.value} value={mode.value}>
              <div className="flex flex-col">
                <span className="font-medium">{mode.label}</span>
                <span className="text-xs text-muted-foreground">{mode.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    {/* Preferred Carrier Dropdown - Only enabled after delivery mode is selected */}
    <div>
      <Label htmlFor="carrier">Preferred Carrier</Label>
      <Select 
        value={formData.carrierId} 
        onValueChange={(value) => setFormData({ ...formData, carrierId: value })}
        disabled={!deliveryMode}
      >
        <SelectTrigger>
          <SelectValue 
            placeholder={
              !deliveryMode 
                ? "Select delivery mode first" 
                : carriersLoading 
                  ? "Loading carriers..." 
                  : "Select carrier (optional)"
            } 
          />
        </SelectTrigger>
        <SelectContent>
          {carriersError ? (
            <SelectItem value="error" disabled>Error loading carriers</SelectItem>
          ) : getAvailableCarriers().length === 0 ? (
            <SelectItem value="empty" disabled>
              {deliveryMode ? "No carriers available for this mode" : "Select delivery mode first"}
            </SelectItem>
          ) : (
            getAvailableCarriers().map((carrier) => (
              <SelectItem key={carrier.id} value={carrier.id}>
                {carrier.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {deliveryMode && (
        <p className="text-xs text-muted-foreground mt-1">
          Available for {deliveryModes.find(m => m.value === deliveryMode)?.label}
        </p>
      )}
    </div>
  </div>

  {/* Special Handling */}
  <div className="mt-4">
    <Label htmlFor="specialHandling">Special Handling</Label>
    <Input 
      id="specialHandling" 
      placeholder="Fragile, temperature controlled, etc." 
      value={formData.specialHandlingRequirements || ''}
      onChange={(e) => setFormData({ 
        ...formData, 
        specialHandlingRequirements: e.target.value 
      })}
    />
  </div>

  {/* Additional Notes */}
  <div className="mt-4">
    <Label htmlFor="notes">Additional Notes</Label>
    <Textarea 
      id="notes" 
      placeholder="Any additional information for the delivery team..." 
      rows={3}
      value={formData.notes || ''}
      onChange={(e) => setFormData({ 
        ...formData, 
        notes: e.target.value 
      })}
    />
  </div>
</div>