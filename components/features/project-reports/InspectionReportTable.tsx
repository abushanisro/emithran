'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { InspectionReport, InspectionDetail } from '@/lib/api/project-reports';
import { Download, Edit, FileText, Printer } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface InspectionReportTableProps {
  report: InspectionReport;
  onUpdateReport?: (updatedReport: Partial<InspectionReport>) => void;
  isEditable?: boolean;
}

function BalloonDrawingSection({ report }: { report: InspectionReport }) {
  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">1.3 BALLOON DRAWING</h2>
        <Badge variant="outline">Technical Drawing</Badge>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <span className="font-medium">Material:</span>
            <span className="text-blue-600 font-semibold">{report.material}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <span className="font-medium">Surface Treatment:</span>
            <span className="text-blue-600 font-semibold">{report.surface_treatment}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <span className="font-medium">Part Name:</span>
            <span className="text-blue-600 font-semibold">{report.part_name}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <span className="font-medium">Drawing No.:</span>
            <span className="text-blue-600 font-semibold">{report.drawing_no}</span>
          </div>
        </div>
        
        <div className="space-y-3">
          <h4 className="font-medium text-gray-700">General Notes:</h4>
          <ul className="space-y-1 text-sm">
            {report.general_notes.map((note, index) => (
              <li key={index} className="flex items-start">
                <span className="w-2 h-2 bg-blue-500 rounded-full mt-2 mr-2 flex-shrink-0"></span>
                {note}
              </li>
            ))}
          </ul>
          <div className="mt-4 p-3 bg-gray-50 rounded">
            <strong>Section:</strong> A–A
          </div>
        </div>
      </div>
    </Card>
  );
}

function InspectionDetailsTable({ 
  inspectionDetails, 
  onUpdateDetail,
  isEditable 
}: { 
  inspectionDetails: InspectionDetail[];
  onUpdateDetail?: (index: number, detail: InspectionDetail) => void;
  isEditable?: boolean;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingDetail, setEditingDetail] = useState<InspectionDetail | null>(null);

  const handleEdit = (index: number, detail: InspectionDetail) => {
    setEditingIndex(index);
    setEditingDetail({ ...detail });
  };

  const handleSave = () => {
    if (editingIndex !== null && editingDetail && onUpdateDetail) {
      onUpdateDetail(editingIndex, editingDetail);
      setEditingIndex(null);
      setEditingDetail(null);
    }
  };

  const getStatusColor = (measurements: number[], gt: number, lt: number, specification: string) => {
    if (measurements.length === 0) return 'yellow';
    
    const specMatch = specification.match(/(\d+(?:\.\d+)?)/);
    const target = specMatch ? parseFloat(specMatch[1]) : 0;
    
    const allInTolerance = measurements.every(value => 
      value >= (target + lt) && value <= (target + gt)
    );
    
    return allInTolerance ? 'green' : 'red';
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="text-center font-semibold">S.No</TableHead>
            <TableHead className="font-semibold">Description</TableHead>
            <TableHead className="text-center font-semibold">Specification (mm)</TableHead>
            <TableHead className="text-center font-semibold">GT</TableHead>
            <TableHead className="text-center font-semibold">LT</TableHead>
            <TableHead className="text-center font-semibold">UOM</TableHead>
            <TableHead className="text-center font-semibold">1</TableHead>
            <TableHead className="text-center font-semibold">2</TableHead>
            <TableHead className="text-center font-semibold">3</TableHead>
            <TableHead className="text-center font-semibold">4</TableHead>
            <TableHead className="text-center font-semibold">5</TableHead>
            <TableHead className="text-center font-semibold">Remarks</TableHead>
            {isEditable && <TableHead className="text-center font-semibold">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {inspectionDetails.map((detail, index) => {
            const statusColor = getStatusColor(detail.measurements, detail.gt, detail.lt, detail.specification);
            const isEditing = editingIndex === index;
            
            return (
              <TableRow 
                key={index}
                className={`
                  ${statusColor === 'green' ? 'bg-green-50 hover:bg-green-100' : ''}
                  ${statusColor === 'red' ? 'bg-red-50 hover:bg-red-100' : ''}
                  ${statusColor === 'yellow' ? 'bg-yellow-50 hover:bg-yellow-100' : ''}
                `}
              >
                <TableCell className="text-center font-medium">{detail.s_no}</TableCell>
                <TableCell className="font-medium">{detail.description}</TableCell>
                <TableCell className="text-center">{detail.specification}</TableCell>
                <TableCell className="text-center">+{detail.gt}</TableCell>
                <TableCell className="text-center">{detail.lt}</TableCell>
                <TableCell className="text-center">{detail.uom}</TableCell>
                
                {Array.from({ length: 5 }, (_, i) => (
                  <TableCell key={i} className="text-center">
                    {detail.measurements[i] ? (
                      <span className={`
                        inline-block px-2 py-1 rounded text-sm font-medium
                        ${statusColor === 'green' ? 'bg-green-100 text-green-800' : ''}
                        ${statusColor === 'red' ? 'bg-red-100 text-red-800' : ''}
                        ${statusColor === 'yellow' ? 'bg-yellow-100 text-yellow-800' : ''}
                      `}>
                        {detail.measurements[i].toFixed(2)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                ))}
                
                <TableCell className="text-center">
                  <Badge 
                    variant={statusColor === 'green' ? 'default' : 'destructive'}
                    className={`
                      ${statusColor === 'green' ? 'bg-green-100 text-green-800 hover:bg-green-200' : ''}
                      ${statusColor === 'red' ? 'bg-red-100 text-red-800 hover:bg-red-200' : ''}
                      ${statusColor === 'yellow' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' : ''}
                    `}
                  >
                    {detail.remarks || (statusColor === 'green' ? 'OK' : 'CHECK')}
                  </Badge>
                </TableCell>
                
                {isEditable && (
                  <TableCell className="text-center">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button 
                          size="sm" 
                          variant="ghost"
                          onClick={() => handleEdit(index, detail)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Edit Inspection Detail</DialogTitle>
                        </DialogHeader>
                        {isEditing && editingDetail && (
                          <div className="space-y-4">
                            <div>
                              <Label>Description</Label>
                              <Input
                                value={editingDetail.description}
                                onChange={(e) => setEditingDetail(prev => 
                                  prev ? { ...prev, description: e.target.value } : null
                                )}
                              />
                            </div>
                            <div>
                              <Label>Specification</Label>
                              <Input
                                value={editingDetail.specification}
                                onChange={(e) => setEditingDetail(prev => 
                                  prev ? { ...prev, specification: e.target.value } : null
                                )}
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label>GT Tolerance</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editingDetail.gt}
                                  onChange={(e) => setEditingDetail(prev => 
                                    prev ? { ...prev, gt: parseFloat(e.target.value) || 0 } : null
                                  )}
                                />
                              </div>
                              <div>
                                <Label>LT Tolerance</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editingDetail.lt}
                                  onChange={(e) => setEditingDetail(prev => 
                                    prev ? { ...prev, lt: parseFloat(e.target.value) || 0 } : null
                                  )}
                                />
                              </div>
                            </div>
                            <div>
                              <Label>Measurements (comma separated)</Label>
                              <Input
                                value={editingDetail.measurements.join(', ')}
                                onChange={(e) => {
                                  const values = e.target.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
                                  setEditingDetail(prev => 
                                    prev ? { ...prev, measurements: values } : null
                                  );
                                }}
                              />
                            </div>
                            <div>
                              <Label>Remarks</Label>
                              <Input
                                value={editingDetail.remarks || ''}
                                onChange={(e) => setEditingDetail(prev => 
                                  prev ? { ...prev, remarks: e.target.value } : null
                                )}
                              />
                            </div>
                            <Button onClick={handleSave} className="w-full">
                              Save Changes
                            </Button>
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function InspectionReportTable({
  report,
  onUpdateReport,
  isEditable = false,
}: InspectionReportTableProps) {
  const handleUpdateDetail = (index: number, updatedDetail: InspectionDetail) => {
    if (!onUpdateReport) return;
    
    const updatedDetails = [...report.inspection_details];
    updatedDetails[index] = updatedDetail;
    
    onUpdateReport({
      inspection_details: updatedDetails,
    });
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    const dataStr = JSON.stringify(report, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inspection-report-${report.part_name}-${report.inspection_date}.json`;
    link.click();
  };

  return (
    <div className="space-y-6">
      <BalloonDrawingSection report={report} />
      
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">1.4 FINAL INSPECTION REPORT</h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="font-medium">Company Name:</span>
              <span className="text-blue-600 font-semibold">{report.company_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Part Name:</span>
              <span>{report.part_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Part Number:</span>
              <span>{report.part_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Revision:</span>
              <span>{report.revision}</span>
            </div>
          </div>
          
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="font-medium">Inspection Date:</span>
              <span className="text-green-600 font-semibold">{report.inspection_date}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Raw Material:</span>
              <span>{report.raw_material}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Inspected by:</span>
              <span className="text-blue-600 font-semibold">{report.inspected_by}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Approved by:</span>
              <span className="text-green-600 font-semibold">{report.approved_by}</span>
            </div>
          </div>
        </div>
        
        <Separator className="my-6" />
        
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-3">Inspection Details Table</h3>
          <InspectionDetailsTable
            inspectionDetails={report.inspection_details}
            onUpdateDetail={isEditable ? handleUpdateDetail : undefined}
            isEditable={isEditable}
          />
        </div>
        
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="bg-green-100 text-green-800">
                <FileText className="h-3 w-3 mr-1" />
                Approved
              </Badge>
              <span className="text-sm text-gray-600">
                Report generated on {report.inspection_date}
              </span>
            </div>
            
            <div className="text-sm text-gray-600">
              Total measurements: {report.inspection_details.reduce((acc, detail) => 
                acc + detail.measurements.filter(m => m > 0).length, 0
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}