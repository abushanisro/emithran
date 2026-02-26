'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Download, Printer, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface InspectionReportProps {
  inspection: any;
  onBack: () => void;
}

export default function ProfessionalInspectionReport({ inspection, onBack }: InspectionReportProps) {
  if (!inspection) return null;

  const getObservationIcon = (result: string) => {
    switch (result) {
      case 'pass':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'fail':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'conditional':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      default:
        return <span className="text-gray-400">-</span>;
    }
  };

  const getObservationValue = (result: string, measurement?: string) => {
    if (result === 'pass') return '✓';
    if (result === 'fail') return '✗';
    if (measurement) return measurement;
    return '-';
  };

  // Generate inspection checklist from inspection data
  const inspectionChecklist = inspection?.checklist || [];
  const checklistResults = inspection?.results || [];

  return (
    <div className="min-h-screen bg-white p-8 font-mono text-sm">
      {/* Header Controls */}
      <div className="flex items-center justify-between mb-8 print:hidden">
        <Button variant="outline" onClick={onBack} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Quality Control
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-2" />
            Print Report
          </Button>
          <Button>
            <Download className="h-4 w-4 mr-2" />
            Download PDF
          </Button>
        </div>
      </div>

      {/* Report Header */}
      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center">
          <div className="bg-slate-800 text-white px-6 py-2 font-bold text-lg">
            QUALITY INSPECTION REPORT
          </div>
          <div className="bg-orange-400 text-white px-6 py-2 font-bold text-lg">
            EMUSKI
          </div>
        </div>
      </div>

      {/* Report Content */}
      <div className="space-y-8">
        {/* 1.5 QUALITY AUDIT CHECK SHEET */}
        <div>
          <h2 className="text-base font-bold mb-4">1.5 QUALITY AUDIT CHECK SHEET</h2>
          
          <div className="border border-gray-400">
            {/* Table Header */}
            <div className="grid grid-cols-12 border-b border-gray-400">
              <div className="col-span-1 border-r border-gray-400 bg-blue-200 p-2 text-center font-semibold">
                S.No
              </div>
              <div className="col-span-4 border-r border-gray-400 bg-blue-200 p-2 text-center font-semibold">
                ACTIVITY
              </div>
              <div className="col-span-4 border-r border-gray-400 bg-blue-200 p-2 text-center font-semibold">
                SPECIFIED
              </div>
              <div className="col-span-3 bg-blue-200 p-2">
                <div className="text-center font-semibold mb-1">OBSERVATION</div>
                <div className="grid grid-cols-2 border-t border-gray-400">
                  <div className="text-center font-semibold border-r border-gray-400 px-1 py-1">OK</div>
                  <div className="text-center font-semibold px-1 py-1">Value</div>
                </div>
              </div>
            </div>

            {/* Table Rows */}
            {inspectionChecklist.map((item: any, index: number) => {
              const result = checklistResults.find((r: any) => r.checkId === item.id);
              
              return (
                <div key={item.id} className="grid grid-cols-12 border-b border-gray-400">
                  <div className="col-span-1 border-r border-gray-400 p-2 text-center">
                    {index + 1}
                  </div>
                  <div className="col-span-4 border-r border-gray-400 p-2">
                    {item.requirement || item.description || 'Inspection Item'}
                  </div>
                  <div className="col-span-4 border-r border-gray-400 p-2">
                    {item.specification || item.acceptanceCriteria || 'As per specification'}
                  </div>
                  <div className="col-span-3 p-2">
                    <div className="grid grid-cols-2">
                      <div className="text-center border-r border-gray-400 pr-2">
                        {result?.status === 'pass' ? '✓' : result?.status === 'fail' ? '✗' : '-'}
                      </div>
                      <div className="text-center pl-2">
                        {result?.measurement || (result?.status === 'pass' ? '✓' : result?.status === 'fail' ? '✗' : '-')}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Inspector signature row */}
            <div className="grid grid-cols-12 bg-gray-50">
              <div className="col-span-8 border-r border-gray-400 p-2 font-semibold">
                Inspected by: {inspection?.inspector || 'Inspector Name'}
              </div>
              <div className="col-span-4 p-2 text-center">
                <div className="text-xs text-gray-600">Signature & Date</div>
                <div className="mt-2 text-sm">{new Date(inspection?.created_at || Date.now()).toLocaleDateString()}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 1.6 PRODUCT IMAGES */}
        <div>
          <h2 className="text-base font-bold mb-4">1.6 PRODUCT IMAGES</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Display product images if available */}
            {inspection?.bomItems?.map((item: any, index: number) => (
              <div key={item.id} className="border border-gray-300 p-2">
                <div className="aspect-square bg-gray-100 flex items-center justify-center mb-2">
                  {item.imageUrl ? (
                    <img 
                      src={item.imageUrl} 
                      alt={item.name}
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <div className="text-gray-400 text-center">
                      <div className="w-16 h-16 bg-gray-200 mx-auto mb-2 flex items-center justify-center">
                        <span className="text-gray-500 text-xs">No Image</span>
                      </div>
                      <div className="text-xs">{item.name || `Part ${index + 1}`}</div>
                    </div>
                  )}
                </div>
                <div className="text-xs text-center">
                  {item.partNumber || item.name || `Part ${index + 1}`}
                </div>
              </div>
            )) || (
              // Placeholder if no parts available
              <div className="border border-gray-300 p-2">
                <div className="aspect-square bg-gray-100 flex items-center justify-center mb-2">
                  <div className="text-gray-400 text-center">
                    <div className="w-16 h-16 bg-gray-200 mx-auto mb-2 flex items-center justify-center">
                      <span className="text-gray-500 text-xs">No Image</span>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-center">Inspected Part</div>
              </div>
            )}
          </div>
        </div>

        {/* Report Summary */}
        <div className="mt-8 border-t pt-4">
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h3 className="font-semibold mb-2">Inspection Summary</h3>
              <div className="space-y-1 text-sm">
                <div>Inspection Type: {inspection?.type || 'First Article'}</div>
                <div>Date: {new Date(inspection?.created_at || Date.now()).toLocaleDateString()}</div>
                <div>Inspector: {inspection?.inspector || 'Not specified'}</div>
                <div>Total Items Checked: {inspectionChecklist.length}</div>
              </div>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Overall Result</h3>
              <div className="flex items-center gap-2 mb-2">
                {getObservationIcon(inspection?.overall_result || 'pass')}
                <Badge 
                  variant={
                    inspection?.overall_result === 'pass' ? 'default' : 
                    inspection?.overall_result === 'fail' ? 'destructive' : 
                    'secondary'
                  }
                  className="text-sm"
                >
                  {(inspection?.overall_result || 'pass').toUpperCase()}
                </Badge>
              </div>
              {inspection?.notes && (
                <div className="text-sm">
                  <strong>Notes:</strong> {inspection.notes}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}