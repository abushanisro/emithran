'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  FileText, 
  Download, 
  Upload, 
  Shield, 
  CheckCircle,
  AlertTriangle,
  Clock,
  Plus,
  Search,
  Eye,
  Edit,
  Archive,
  Printer,
  Mail,
  FileCheck,
  Award,
  Truck,
  Package,
  ScrollText,
  Building2,
  Calendar
} from 'lucide-react';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DeliveryOrder } from '@/lib/api/hooks/useDelivery';

interface DocumentationComplianceProps {
  projectId: string;
  deliveryOrders: DeliveryOrder[];
}

interface ComplianceDocument {
  id: string;
  type: 'bill_of_lading' | 'packing_list' | 'invoice' | 'quality_certificate' | 'customs_declaration' | 'insurance_certificate' | 'delivery_receipt';
  title: string;
  description: string;
  status: 'draft' | 'pending_review' | 'approved' | 'expired' | 'rejected';
  deliveryOrderId?: string;
  orderNumber?: string;
  generatedDate?: string;
  expiryDate?: string;
  documentNumber?: string;
  approvedBy?: string;
  notes?: string;
}

export default function DocumentationCompliance({ 
  projectId, 
  deliveryOrders 
}: DocumentationComplianceProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // Mock compliance documents - replace with real API call
  const [complianceDocuments] = useState<ComplianceDocument[]>([
    {
      id: '1',
      type: 'bill_of_lading',
      title: 'Bill of Lading - DEL001',
      description: 'Shipping manifest for delivery order DEL001',
      status: 'approved',
      deliveryOrderId: 'del-001',
      orderNumber: 'DEL001',
      generatedDate: '2024-01-15T10:00:00Z',
      documentNumber: 'BOL-2024-001',
      approvedBy: 'logistics.manager@company.com'
    },
    {
      id: '2',
      type: 'quality_certificate',
      title: 'QC Certificate - Batch QA-2024-005',
      description: 'Quality assurance certification for shipped components',
      status: 'approved',
      deliveryOrderId: 'del-001',
      orderNumber: 'DEL001',
      generatedDate: '2024-01-14T14:30:00Z',
      expiryDate: '2025-01-14T14:30:00Z',
      documentNumber: 'QC-CERT-2024-005',
      approvedBy: 'quality.control@company.com'
    },
    {
      id: '3',
      type: 'packing_list',
      title: 'Packing List - DEL002',
      description: 'Detailed packing manifest and item specifications',
      status: 'pending_review',
      deliveryOrderId: 'del-002',
      orderNumber: 'DEL002',
      generatedDate: '2024-01-16T09:15:00Z',
      documentNumber: 'PKL-2024-002'
    },
    {
      id: '4',
      type: 'invoice',
      title: 'Commercial Invoice - INV-2024-003',
      description: 'Delivery charges and billing details',
      status: 'approved',
      deliveryOrderId: 'del-001',
      orderNumber: 'DEL001',
      generatedDate: '2024-01-15T16:00:00Z',
      documentNumber: 'INV-2024-003',
      approvedBy: 'accounting@company.com'
    },
    {
      id: '5',
      type: 'customs_declaration',
      title: 'Customs Declaration - CD-2024-001',
      description: 'International shipping customs documentation',
      status: 'draft',
      deliveryOrderId: 'del-003',
      orderNumber: 'DEL003',
      generatedDate: '2024-01-17T11:00:00Z',
      documentNumber: 'CD-2024-001'
    }
  ]);

  const filteredDocuments = complianceDocuments.filter(doc => {
    const matchesSearch = !searchTerm || 
      doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.orderNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      doc.documentNumber?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = !documentTypeFilter || documentTypeFilter === 'all' || doc.type === documentTypeFilter;
    const matchesStatus = !statusFilter || statusFilter === 'all' || doc.status === statusFilter;
    
    return matchesSearch && matchesType && matchesStatus;
  });

  const getDocumentIcon = (type: string) => {
    const icons = {
      'bill_of_lading': Truck,
      'packing_list': Package,
      'invoice': FileText,
      'quality_certificate': Award,
      'customs_declaration': Building2,
      'insurance_certificate': Shield,
      'delivery_receipt': ScrollText
    };
    
    return icons[type] || FileText;
  };

  const getDocumentStatusBadge = (status: string) => {
    const statusConfig = {
      'draft': { color: 'bg-gray-100 text-gray-800', label: 'Draft', icon: Edit },
      'pending_review': { color: 'bg-yellow-100 text-yellow-800', label: 'Pending Review', icon: Clock },
      'approved': { color: 'bg-green-100 text-green-800', label: 'Approved', icon: CheckCircle },
      'expired': { color: 'bg-red-100 text-red-800', label: 'Expired', icon: AlertTriangle },
      'rejected': { color: 'bg-red-100 text-red-800', label: 'Rejected', icon: AlertTriangle }
    };

    const config = statusConfig[status] || statusConfig['draft'];
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1 text-xs`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const getDocumentTypeLabel = (type: string) => {
    const typeLabels = {
      'bill_of_lading': 'Bill of Lading',
      'packing_list': 'Packing List',
      'invoice': 'Invoice',
      'quality_certificate': 'Quality Certificate',
      'customs_declaration': 'Customs Declaration',
      'insurance_certificate': 'Insurance Certificate',
      'delivery_receipt': 'Delivery Receipt'
    };
    
    return typeLabels[type] || type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const getComplianceOverview = () => {
    const total = complianceDocuments.length;
    const approved = complianceDocuments.filter(d => d.status === 'approved').length;
    const pending = complianceDocuments.filter(d => d.status === 'pending_review').length;
    const expired = complianceDocuments.filter(d => d.status === 'expired').length;
    
    return { total, approved, pending, expired };
  };

  const overview = getComplianceOverview();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Documentation & Compliance</h2>
          <p className="text-sm text-muted-foreground">
            Manage delivery documentation, certificates, and compliance records
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload Document
          </Button>
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Generate Document
          </Button>
        </div>
      </div>

      {/* Compliance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Total Documents</p>
                <p className="text-xl font-bold">{overview.total}</p>
              </div>
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Approved</p>
                <p className="text-xl font-bold text-green-600">{overview.approved}</p>
              </div>
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Pending Review</p>
                <p className="text-xl font-bold text-yellow-600">{overview.pending}</p>
              </div>
              <Clock className="h-6 w-6 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Compliance Rate</p>
                <p className="text-xl font-bold text-blue-600">
                  {overview.total > 0 ? Math.round((overview.approved / overview.total) * 100) : 0}%
                </p>
              </div>
              <Shield className="h-6 w-6 text-blue-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder="Search documents, order numbers, or document numbers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <Select value={documentTypeFilter} onValueChange={setDocumentTypeFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Document type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="bill_of_lading">Bill of Lading</SelectItem>
                <SelectItem value="packing_list">Packing List</SelectItem>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="quality_certificate">Quality Certificate</SelectItem>
                <SelectItem value="customs_declaration">Customs Declaration</SelectItem>
                <SelectItem value="insurance_certificate">Insurance Certificate</SelectItem>
                <SelectItem value="delivery_receipt">Delivery Receipt</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="pending_review">Pending Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Documents List */}
      <div className="grid gap-4">
        {filteredDocuments.map((document) => {
          const IconComponent = getDocumentIcon(document.type);
          
          return (
            <Card key={document.id} className="hover:shadow-md transition-shadow">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <IconComponent className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{document.title}</CardTitle>
                        <p className="text-sm text-muted-foreground">{document.description}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-muted-foreground ml-12">
                      <div className="flex items-center gap-1">
                        <FileCheck className="h-4 w-4" />
                        <span>{getDocumentTypeLabel(document.type)}</span>
                      </div>
                      {document.documentNumber && (
                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          <span>{document.documentNumber}</span>
                        </div>
                      )}
                      {document.orderNumber && (
                        <div className="flex items-center gap-1">
                          <Package className="h-4 w-4" />
                          <span>Order: {document.orderNumber}</span>
                        </div>
                      )}
                      {document.generatedDate && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>Generated: {new Date(document.generatedDate).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {getDocumentStatusBadge(document.status)}
                    
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          Actions
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Eye className="h-4 w-4 mr-2" />
                          View Document
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Download className="h-4 w-4 mr-2" />
                          Download PDF
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Printer className="h-4 w-4 mr-2" />
                          Print
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Mail className="h-4 w-4 mr-2" />
                          Email
                        </DropdownMenuItem>
                        {document.status === 'draft' && (
                          <DropdownMenuItem>
                            <Edit className="h-4 w-4 mr-2" />
                            Edit Document
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem>
                          <Archive className="h-4 w-4 mr-2" />
                          Archive
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="space-y-4">
                  {/* Document Details */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="font-medium text-muted-foreground">Status</p>
                      <p className="capitalize">{document.status.replace('_', ' ')}</p>
                    </div>
                    {document.approvedBy && (
                      <div>
                        <p className="font-medium text-muted-foreground">Approved By</p>
                        <p>{document.approvedBy}</p>
                      </div>
                    )}
                    {document.expiryDate && (
                      <div>
                        <p className="font-medium text-muted-foreground">Expiry Date</p>
                        <p>{new Date(document.expiryDate).toLocaleDateString()}</p>
                      </div>
                    )}
                  </div>

                  {document.notes && (
                    <div>
                      <p className="font-medium text-muted-foreground text-sm">Notes</p>
                      <p className="text-sm">{document.notes}</p>
                    </div>
                  )}

                  {/* Quick Actions */}
                  <div className="flex gap-2 pt-2 border-t">
                    <Button size="sm" className="flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      Download
                    </Button>
                    <Button size="sm" variant="outline" className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      Preview
                    </Button>
                    {document.status === 'pending_review' && (
                      <Button size="sm" variant="outline" className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3" />
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredDocuments.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Documents Found</h3>
            <p className="text-muted-foreground mb-4">
              No compliance documents found matching your criteria.
            </p>
            <Button className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create First Document
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}