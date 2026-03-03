"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Send, Eye, Copy, Paperclip, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useBOMItems, type BOMItem } from "@/lib/api/hooks/useBOMItems";
import { useVendors } from "@/lib/api/hooks/useVendors";
import { type Vendor } from "@/lib/api/vendors";
import { useAuth } from "@/lib/providers/auth";
import { useCreateRfq } from "@/lib/api/hooks/useRfq";

interface RFQFormData {
  rfqName: string;
  selectedParts: string[];
  quoteDeadline: string;
  selectionType: 'single' | 'multiple' | 'competitive';
  buyerName: string;
  emailBody: string;
  selectedSuppliers: string[];
}

interface RFQShareFormProps {
  projectId: string;
  bomId: string;
  onRFQSent?: (data: RFQFormData) => void;
  className?: string;
}

export function RFQShareForm({ projectId, bomId, onRFQSent, className }: RFQShareFormProps) {
  const { user } = useAuth();

  // Fetch real data from APIs
  const { data: bomItemsResponse, isLoading: bomLoading } = useBOMItems(bomId);
  const { data: vendorsResponse, isLoading: vendorsLoading } = useVendors();

  const bomItems = bomItemsResponse?.items || [];
  const vendors = vendorsResponse?.vendors || [];
  const [formData, setFormData] = useState<RFQFormData>({
    rfqName: `RFQ-${new Date().toISOString().split('T')[0] || ''}`,
    selectedParts: [],
    quoteDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] || '', // 2 weeks from now
    selectionType: 'competitive',
    buyerName: user?.user_metadata?.full_name || '',
    emailBody: 'We are seeking quotations for the following parts as part of our manufacturing process. Please provide detailed quotes including lead times, minimum order quantities, and pricing tiers.',
    selectedSuppliers: [],
  });

  const [showPreview, setShowPreview] = useState(false);

  const handlePartToggle = (partId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedParts: prev.selectedParts.includes(partId)
        ? prev.selectedParts.filter((id) => id !== partId)
        : [...prev.selectedParts, partId],
    }));
  };

  const handleSupplierToggle = (supplierId: string) => {
    setFormData((prev) => ({
      ...prev,
      selectedSuppliers: prev.selectedSuppliers.includes(supplierId)
        ? prev.selectedSuppliers.filter((id) => id !== supplierId)
        : [...prev.selectedSuppliers, supplierId],
    }));
  };

  // Get detailed part information
  const selectedPartsDetails = useMemo(() => {
    return bomItems.filter((item) => formData.selectedParts.includes(item.id));
  }, [bomItems, formData.selectedParts]);

  // Get selected vendor contact details
  const selectedVendorsDetails = useMemo(() => {
    return vendors.filter((vendor: Vendor) => formData.selectedSuppliers.includes(vendor.id));
  }, [vendors, formData.selectedSuppliers]);

  const generateEmailPreview = () => {
    const selectedPartsList = selectedPartsDetails
      .map((item) => {
        const features = [];
        if (item.file2dPath) features.push('2D Drawing Available');
        if (item.file3dPath) features.push('3D Model Available');
        if (item.material) features.push(`Material: ${item.material}`);
        if (item.materialGrade) features.push(`Grade: ${item.materialGrade}`);

        return `• ${item.partNumber || item.name}: ${item.description || 'N/A'}\n  Quantity: ${item.quantity}, Annual Volume: ${item.annualVolume}\n  ${features.length > 0 ? `Features: ${features.join(', ')}` : ''}`;
      })
      .join('\n\n');

    return {
      subject: `RFQ: ${formData.rfqName}`,
      body: `Dear Supplier Partner,\n\n${formData.emailBody}\n\nPart Requirements:\n${selectedPartsList || 'No parts selected'}\n\nDeliverables Required:\n• Technical specifications and material certifications\n• Manufacturing process plan and quality control procedures\n• Detailed cost breakdown including tooling, setup, and per-unit costs\n• Lead times for prototype, pilot, and production quantities\n• Quality assurance documentation and inspection reports\n${selectedPartsDetails.some(p => p.file2dPath || p.file3dPath) ? '• Technical drawings and 3D models (attached separately)' : ''}\n\nQuote Deadline: ${formData.quoteDeadline}\nSelection Criteria: ${formData.selectionType}\n\nPlease include:\n- Payment terms and conditions\n- Packaging and shipping requirements\n- Any special certifications or compliance requirements\n\nBest Regards,\n${formData.buyerName}\nProject: ${projectId}`,
    };
  };

  const createRfqMutation = useCreateRfq();

  const handleSendRFQ = async () => {
    if (!formData.rfqName || formData.selectedParts.length === 0 || formData.selectedSuppliers.length === 0) {
      toast.error('Please fill in all required fields');
      return;
    }

    try {
      // Create RFQ record using the API
      const rfqData = {
        rfqName: formData.rfqName,
        projectId,
        bomItemIds: formData.selectedParts,
        vendorIds: formData.selectedSuppliers,
        quoteDeadline: formData.quoteDeadline ? new Date(formData.quoteDeadline) : undefined,
        selectionType: formData.selectionType as 'single' | 'multiple' | 'competitive',
        buyerName: formData.buyerName || undefined,
        emailBody: formData.emailBody || undefined,
        emailSubject: `RFQ: ${formData.rfqName}`,
      };

      await createRfqMutation.mutateAsync(rfqData);

      onRFQSent?.(formData);

      // Reset form for next RFQ
      setFormData({
        rfqName: `RFQ-${new Date().toISOString().split('T')[0] || ''}`,
        selectedParts: [],
        quoteDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] || '',
        selectionType: 'competitive',
        buyerName: user?.user_metadata?.full_name || '',
        emailBody: 'We are seeking quotations for the following parts as part of our manufacturing process. Please provide detailed quotes including lead times, minimum order quantities, and pricing tiers.',
        selectedSuppliers: [],
      });

    } catch (error) {
      console.error('Failed to send RFQ:', error);
      // Error is already handled by the mutation hook
    }
  };

  const handleCopyEmail = () => {
    const preview = generateEmailPreview();
    navigator.clipboard.writeText(`Subject: ${preview.subject}\n\n${preview.body}`);
    toast.success("Email content copied to clipboard");
  };

  if (bomLoading || vendorsLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center h-32">
          <div className="text-sm text-muted-foreground">Loading BOM items and vendors...</div>
        </div>
      </Card>
    );
  }

  return (
    <div className={`space-y-6 ${className || ''}`}>
      {/* Form Section */}
      <Card className="p-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">Create RFQ for BOM Items</h3>
          <p className="text-sm text-muted-foreground">
            Select parts from the BOM and vendors to create a Request for Quote. All technical drawings and specifications will be automatically included.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="rfqName" className="flex items-center gap-2">
                RFQ Name
                <Badge variant="secondary">Required</Badge>
              </Label>
              <Input
                id="rfqName"
                placeholder="Enter RFQ name"
                value={formData.rfqName}
                onChange={(e) => setFormData({ ...formData, rfqName: e.target.value })}
                className="mt-2"
                required
              />
            </div>

            <div>
              <Label className="flex items-center gap-2">
                BOM Parts
                <Badge variant="secondary">{bomItems.length} Available</Badge>
              </Label>
              <Card className="mt-2 p-4 max-h-64 overflow-y-auto">
                <div className="space-y-2">
                  {bomItems.length > 0 ? (
                    bomItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 p-3 hover:bg-muted/50 rounded-lg cursor-pointer border border-transparent hover:border-border"
                        onClick={() => handlePartToggle(item.id)}
                      >
                        <Checkbox
                          checked={formData.selectedParts.includes(item.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm truncate">
                              {item.partNumber || item.name}
                            </p>
                            <div className="flex gap-1">
                              {item.file2dPath && (
                                <Badge variant="outline" className="text-xs px-1 py-0">
                                  2D
                                </Badge>
                              )}
                              {item.file3dPath && (
                                <Badge variant="outline" className="text-xs px-1 py-0">
                                  3D
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {item.description || 'No description'}
                          </p>
                          <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                            <span>Qty: {item.quantity}</span>
                            <span>Annual: {item.annualVolume}</span>
                            {item.material && <span>Material: {item.material}</span>}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No BOM items available for this BOM
                    </p>
                  )}
                </div>
              </Card>
              {formData.selectedParts.length > 0 && (
                <div className="flex items-center gap-2 mt-2">
                  <Badge>{formData.selectedParts.length} parts selected</Badge>
                  {selectedPartsDetails.some(p => p.file2dPath || p.file3dPath) && (
                    <Badge variant="outline" className="text-xs">
                      Drawings Available
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="quoteDeadline">Quote Deadline Date</Label>
              <Input
                id="quoteDeadline"
                type="date"
                value={formData.quoteDeadline}
                onChange={(e) => setFormData({ ...formData, quoteDeadline: e.target.value })}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="selectionType">Selection Type</Label>
              <Select
                value={formData.selectionType}
                onValueChange={(value: 'single' | 'multiple' | 'competitive') => setFormData({ ...formData, selectionType: value })}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single Supplier</SelectItem>
                  <SelectItem value="multiple">Multiple Suppliers</SelectItem>
                  <SelectItem value="competitive">Competitive Bidding</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="buyerName" className="flex items-center gap-2">
                Buyer Name
                <Badge variant="secondary">Auto-filled</Badge>
              </Label>
              <Input
                id="buyerName"
                placeholder="Enter buyer name"
                value={formData.buyerName}
                onChange={(e) => setFormData({ ...formData, buyerName: e.target.value })}
                className="mt-2"
              />
            </div>

            <div>
              <Label htmlFor="emailBody" className="flex items-center gap-2">
                Body of email data
                <Badge variant="secondary">Manual Input</Badge>
              </Label>
              <Textarea
                id="emailBody"
                placeholder="Enter email message..."
                value={formData.emailBody}
                onChange={(e) => setFormData({ ...formData, emailBody: e.target.value })}
                rows={5}
                className="mt-2"
              />
            </div>

            <div>
              <Label className="flex items-center gap-2">
                Select Vendors
                <Badge variant="secondary">{vendors.length} Available</Badge>
              </Label>
              <Card className="mt-2 p-4 max-h-64 overflow-y-auto">
                <div className="space-y-2">
                  {vendors.length > 0 ? (
                    vendors.map((vendor: Vendor) => (
                      <VendorSelectionCard
                        key={vendor.id}
                        vendor={vendor}
                        isSelected={formData.selectedSuppliers.includes(vendor.id)}
                        onToggle={() => handleSupplierToggle(vendor.id)}
                      />
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No vendors available. Please add vendors first.
                    </p>
                  )}
                </div>
              </Card>
              {formData.selectedSuppliers.length > 0 && (
                <Badge className="mt-2">{formData.selectedSuppliers.length} vendors selected</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mt-6 pt-6 border-t">
          <Button onClick={() => setShowPreview(!showPreview)} variant="outline">
            <Eye className="h-4 w-4 mr-2" />
            {showPreview ? 'Hide' : 'Show'} Preview
          </Button>
          <Button onClick={handleCopyEmail} variant="outline">
            <Copy className="h-4 w-4 mr-2" />
            Copy Email
          </Button>
          <Button
            onClick={handleSendRFQ}
            className="ml-auto"
            disabled={formData.selectedParts.length === 0 || formData.selectedSuppliers.length === 0 || createRfqMutation.isPending}
          >
            {createRfqMutation.isPending ? (
              <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            {createRfqMutation.isPending ? 'Sending...' : 'Send RFQ'}
          </Button>
        </div>
      </Card>

      {/* Email Preview */}
      {showPreview && (
        <Card className="p-6 bg-muted/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Email Preview</h3>
            <Button size="sm" variant="outline" onClick={handleCopyEmail}>
              <Copy className="h-4 w-4 mr-2" />
              Copy
            </Button>
          </div>

          <div className="space-y-4 bg-white dark:bg-gray-900 p-6 rounded-lg border">
            {/* Email Header */}
            <div className="space-y-2 pb-4 border-b">
              <div className="flex items-start gap-2">
                <span className="text-sm font-semibold min-w-[60px]">To:</span>
                <div className="flex flex-wrap gap-1">
                  {formData.selectedSuppliers.length > 0 ? (
                    selectedVendorsDetails.map((vendor: Vendor) => (
                      <Badge key={vendor.id} variant="secondary">
                        {vendor.companyEmail || vendor.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No recipients selected</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold min-w-[60px]">Subject:</span>
                <span className="text-sm">{generateEmailPreview().subject}</span>
              </div>
            </div>

            {/* Body */}
            <div className="space-y-4">
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm bg-gray-50 dark:bg-gray-800 p-4 rounded border">
                  {generateEmailPreview().body}
                </pre>
              </div>

              {/* Attachments Preview */}
              {selectedPartsDetails.some(p => p.file2dPath || p.file3dPath) && (
                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                    <Paperclip className="h-4 w-4" />
                    Technical Drawings & Models
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {selectedPartsDetails.map((part) => (
                      <div key={part.id} className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded">
                        <p className="font-medium">{part.partNumber || part.name}</p>
                        <div className="flex gap-2 mt-1">
                          {part.file2dPath && (
                            <Badge variant="outline" className="text-xs">
                              2D Drawing
                            </Badge>
                          )}
                          {part.file3dPath && (
                            <Badge variant="outline" className="text-xs">
                              3D Model
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Selected Parts Summary */}
      {formData.selectedParts.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Selected Parts Summary</h3>
          <div className="grid gap-4">
            {selectedPartsDetails.map((part) => (
              <PartSummaryCard key={part.id} part={part} />
            ))}
          </div>
        </Card>
      )}

      {/* Selected Vendors Summary */}
      {formData.selectedSuppliers.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Selected Vendors Summary</h3>
          <div className="grid gap-4">
            {selectedVendorsDetails.map((vendor: Vendor) => (
              <VendorSummaryCard key={vendor.id} vendor={vendor} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// Supporting Components
function VendorSelectionCard({
  vendor,
  isSelected,
  onToggle
}: {
  vendor: Vendor;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 hover:bg-muted/50 rounded-lg cursor-pointer border border-transparent hover:border-border"
      onClick={onToggle}
    >
      <Checkbox checked={isSelected} className="mt-1" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-medium text-sm truncate">{vendor.name}</p>
          {vendor.status === 'active' && (
            <Badge variant="outline" className="text-xs px-1 py-0">Active</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground line-clamp-1">
          {vendor.addresses || 'No company info'}
        </p>
        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
          {vendor.companyEmail && <span>Email: {vendor.companyEmail}</span>}
          {vendor.city && <span>Location: {vendor.city}</span>}
        </div>
      </div>
    </div>
  );
}

function PartSummaryCard({ part }: { part: BOMItem }) {
  return (
    <div className="flex items-start gap-4 p-4 border rounded-lg">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="font-medium">{part.partNumber || part.name}</h4>
          <div className="flex gap-1">
            {part.file2dPath && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
                <ExternalLink className="h-3 w-3 mr-1" />
                View 2D
              </Button>
            )}
            {part.file3dPath && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs">
                <ExternalLink className="h-3 w-3 mr-1" />
                View 3D
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          {part.description || 'No description available'}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-muted-foreground">Quantity:</span>
            <span className="ml-1 font-medium">{part.quantity}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Annual Volume:</span>
            <span className="ml-1 font-medium">{part.annualVolume}</span>
          </div>
          {part.material && (
            <div>
              <span className="text-muted-foreground">Material:</span>
              <span className="ml-1 font-medium">{part.material}</span>
            </div>
          )}
          {part.makeBuy && (
            <div>
              <span className="text-muted-foreground">Make/Buy:</span>
              <span className="ml-1 font-medium capitalize">{part.makeBuy}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VendorSummaryCard({ vendor }: { vendor: Vendor }) {
  return (
    <div className="flex items-start gap-4 p-4 border rounded-lg">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <h4 className="font-medium">{vendor.name}</h4>
          {vendor.status === 'active' && (
            <Badge variant="outline" className="text-xs">Active</Badge>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Addresses:</span>
            <span className="ml-2">{vendor.addresses || 'N/A'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Email:</span>
            <span className="ml-2">{vendor.companyEmail || 'N/A'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Location:</span>
            <span className="ml-2">{vendor.city}{vendor.state ? `, ${vendor.state}` : ''}{vendor.country ? `, ${vendor.country}` : ''}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Phone:</span>
            <span className="ml-2">{vendor.companyPhone || 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
