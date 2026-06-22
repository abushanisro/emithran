/**
 * MHR PDF Export Utility
 * Generates professional invoice-like PDFs for MHR records
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { MHRRecord } from '@/lib/api/mhr';
import { getCommodityLabel } from '@/lib/constants/commodityPresets';

type ExportOptions = {
  records: MHRRecord[];
  companyName?: string;
  companyAddress?: string;
  logo?: string;
};

export const exportMHRToPDF = ({
  records,
  companyName = 'Your Company Name',
  companyAddress = 'Company Address',
}: ExportOptions) => {
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Colors
  const primaryColor: [number, number, number] = [41, 128, 185]; // Professional blue
  const secondaryColor: [number, number, number] = [52, 73, 94]; // Dark blue-gray
  const lightGray: [number, number, number] = [245, 245, 245];

  let currentY = 15;

  // Header Section - Invoice Style
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 35, 'F');

  // Company Name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, 15, 18);

  // Document Title
  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.text('MACHINE HOUR RATE REPORT', 15, 28);

  // Date and Document Info (Right side)
  doc.setFontSize(10);
  const dateStr = new Date().toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  doc.text(`Date: ${dateStr}`, pageWidth - 15, 18, { align: 'right' });
  doc.text(`Total Records: ${records.length}`, pageWidth - 15, 24, { align: 'right' });
  doc.text(`Report ID: MHR-${Date.now()}`, pageWidth - 15, 30, { align: 'right' });

  currentY = 45;

  // Company Address
  doc.setTextColor(...secondaryColor);
  doc.setFontSize(9);
  doc.text(companyAddress, 15, currentY);
  currentY += 10;

  // Summary Statistics Section
  const totalAnnualCost = records.reduce((sum, r) => sum + r.calculations.totalAnnualCost, 0);
  const avgMHR = records.reduce((sum, r) => sum + r.calculations.totalMachineHourRate, 0) / records.length;
  const totalLocations = new Set(records.map(r => r.location)).size;

  doc.setFillColor(...lightGray);
  doc.rect(15, currentY, pageWidth - 30, 25, 'F');

  doc.setTextColor(...secondaryColor);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');

  const statsY = currentY + 8;
  const statSpacing = (pageWidth - 30) / 4;

  // Stat 1: Total Records
  doc.text('TOTAL RECORDS', 20, statsY);
  doc.setFontSize(16);
  doc.setTextColor(...primaryColor);
  doc.text(records.length.toString(), 20, statsY + 10);

  // Stat 2: Average MHR
  doc.setFontSize(10);
  doc.setTextColor(...secondaryColor);
  doc.text('AVG. MACHINE HOUR RATE', 20 + statSpacing, statsY);
  doc.setFontSize(16);
  doc.setTextColor(...primaryColor);
  doc.text(`₹${avgMHR.toFixed(2)}/hr`, 20 + statSpacing, statsY + 10);

  // Stat 3: Total Annual Cost
  doc.setFontSize(10);
  doc.setTextColor(...secondaryColor);
  doc.text('TOTAL ANNUAL COST', 20 + statSpacing * 2, statsY);
  doc.setFontSize(16);
  doc.setTextColor(...primaryColor);
  doc.text(`₹${totalAnnualCost.toLocaleString('en-IN')}`, 20 + statSpacing * 2, statsY + 10);

  // Stat 4: Locations
  doc.setFontSize(10);
  doc.setTextColor(...secondaryColor);
  doc.text('LOCATIONS', 20 + statSpacing * 3, statsY);
  doc.setFontSize(16);
  doc.setTextColor(...primaryColor);
  doc.text(totalLocations.toString(), 20 + statSpacing * 3, statsY + 10);

  currentY += 35;

  // MHR Records Table
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...secondaryColor);
  doc.text('Machine Hour Rate Details', 15, currentY);
  currentY += 8;

  // Prepare table data
  const tableData = records.map(record => [
    record.machineName,
    record.location,
    getCommodityLabel(record.commodityCode),
    record.manufacturer || '-',
    record.model || '-',
    `₹${record.calculations.totalMachineHourRate.toFixed(2)}`,
    `₹${record.calculations.totalFixedCostPerHour.toFixed(2)}`,
    `₹${record.calculations.totalVariableCostPerHour.toFixed(2)}`,
    `₹${record.calculations.totalAnnualCost.toLocaleString('en-IN')}`,
  ]);

  autoTable(doc, {
    startY: currentY,
    head: [[
      'Machine Name',
      'Location',
      'Commodity',
      'Manufacturer',
      'Model',
      'MHR (₹/hr)',
      'Fixed Cost',
      'Variable Cost',
      'Annual Cost',
    ]],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontSize: 9,
      fontStyle: 'bold',
      halign: 'left',
    },
    bodyStyles: {
      fontSize: 8,
      textColor: secondaryColor,
    },
    alternateRowStyles: {
      fillColor: [250, 250, 250],
    },
    columnStyles: {
      0: { cellWidth: 35 }, // Machine Name
      1: { cellWidth: 25 }, // Location
      2: { cellWidth: 25 }, // Commodity
      3: { cellWidth: 28 }, // Manufacturer
      4: { cellWidth: 25 }, // Model
      5: { cellWidth: 25, halign: 'right', fontStyle: 'bold' }, // MHR
      6: { cellWidth: 25, halign: 'right' }, // Fixed Cost
      7: { cellWidth: 28, halign: 'right' }, // Variable Cost
      8: { cellWidth: 30, halign: 'right' }, // Annual Cost
    },
    margin: { left: 15, right: 15 },
  });

  // Footer on each page
  const totalPages = (doc as any).internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Footer line
    doc.setDrawColor(...primaryColor);
    doc.setLineWidth(0.5);
    doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);

    // Footer text
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(
      `Machine Hour Rate Report - ${companyName}`,
      15,
      pageHeight - 10
    );
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - 15,
      pageHeight - 10,
      { align: 'right' }
    );
    doc.text(
      `Generated on ${dateStr}`,
      pageWidth / 2,
      pageHeight - 10,
      { align: 'center' }
    );
  }

  // Save the PDF
  const fileName = `MHR-Report-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
};

/**
 * Export single MHR record with detailed breakdown
 */
export const exportSingleMHRToPDF = (
  record: MHRRecord,
  companyName = 'Your Company Name',
  companyAddress = 'Company Address'
) => {
  const doc = new jsPDF('portrait', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const primaryColor: [number, number, number] = [41, 128, 185];
  const secondaryColor: [number, number, number] = [52, 73, 94];
  const lightGray: [number, number, number] = [245, 245, 245];

  let currentY = 15;

  // Header
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 40, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, 15, 18);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text('MACHINE HOUR RATE CALCULATION', 15, 28);

  doc.setFontSize(9);
  const dateStr = new Date().toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  doc.text(`Date: ${dateStr}`, pageWidth - 15, 18, { align: 'right' });
  doc.text(`MHR ID: ${record.id.slice(0, 8)}`, pageWidth - 15, 24, { align: 'right' });

  currentY = 50;

  // Company Address
  doc.setTextColor(...secondaryColor);
  doc.setFontSize(9);
  doc.text(companyAddress, 15, currentY);
  currentY += 10;

  // Machine Information Section
  doc.setFillColor(...lightGray);
  doc.rect(15, currentY, pageWidth - 30, 45, 'F');

  doc.setTextColor(...primaryColor);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('MACHINE INFORMATION', 20, currentY + 8);

  doc.setTextColor(...secondaryColor);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');

  currentY += 15;
  doc.text(`Machine Name:`, 20, currentY);
  doc.setFont('helvetica', 'bold');
  doc.text(record.machineName, 65, currentY);

  doc.setFont('helvetica', 'normal');
  currentY += 7;
  doc.text(`Location:`, 20, currentY);
  doc.text(record.location, 65, currentY);

  currentY += 7;
  doc.text(`Commodity Code:`, 20, currentY);
  doc.text(getCommodityLabel(record.commodityCode), 65, currentY);

  if (record.manufacturer) {
    currentY += 7;
    doc.text(`Manufacturer:`, 20, currentY);
    doc.text(record.manufacturer, 65, currentY);
  }

  if (record.model) {
    currentY += 7;
    doc.text(`Model:`, 20, currentY);
    doc.text(record.model, 65, currentY);
  }

  currentY += 15;

  // Key Metrics Section
  doc.setFillColor(...primaryColor);
  doc.rect(15, currentY, pageWidth - 30, 35, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('KEY METRICS', 20, currentY + 10);

  const metricsY = currentY + 20;
  const col1X = 20;
  const col2X = pageWidth / 2;

  doc.setFontSize(18);
  doc.text(`₹${record.calculations.totalMachineHourRate.toFixed(2)}/hr`, col1X, metricsY);
  doc.setFontSize(9);
  doc.text('Machine Hour Rate', col1X, metricsY + 5);

  doc.setFontSize(18);
  doc.text(`₹${record.calculations.totalAnnualCost.toLocaleString('en-IN')}`, col2X, metricsY);
  doc.setFontSize(9);
  doc.text('Total Annual Cost', col2X, metricsY + 5);

  currentY += 45;

  // Cost Breakdown Table
  doc.setTextColor(...secondaryColor);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('COST BREAKDOWN', 15, currentY);
  currentY += 8;

  autoTable(doc, {
    startY: currentY,
    head: [['Cost Component', 'Per Hour (₹)', 'Per Annum (₹)']],
    body: [
      ['Depreciation', `${record.calculations.depreciationPerHour.toFixed(2)}`, `${record.calculations.depreciationPerAnnum.toLocaleString('en-IN')}`],
      ['Interest', `${record.calculations.interestPerHour.toFixed(2)}`, `${record.calculations.interestPerAnnum.toLocaleString('en-IN')}`],
      ['Insurance', `${record.calculations.insurancePerHour.toFixed(2)}`, `${record.calculations.insurancePerAnnum.toLocaleString('en-IN')}`],
      ['Rent', `${record.calculations.rentPerHour.toFixed(2)}`, `${record.calculations.rentPerAnnum.toLocaleString('en-IN')}`],
      ['Maintenance', `${record.calculations.maintenancePerHour.toFixed(2)}`, `${record.calculations.maintenancePerAnnum.toLocaleString('en-IN')}`],
      ['Electricity', `${record.calculations.electricityPerHour.toFixed(2)}`, `${record.calculations.electricityPerAnnum.toLocaleString('en-IN')}`],
      ['Admin Overhead', `${record.calculations.adminOverheadPerHour.toFixed(2)}`, '-'],
      ['Profit Margin', `${record.calculations.profitMarginPerHour.toFixed(2)}`, '-'],
    ],
    foot: [['TOTAL', `₹${record.calculations.totalMachineHourRate.toFixed(2)}`, `₹${record.calculations.totalAnnualCost.toLocaleString('en-IN')}`]],
    theme: 'striped',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontSize: 10,
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: secondaryColor,
      textColor: [255, 255, 255],
      fontSize: 10,
      fontStyle: 'bold',
    },
    bodyStyles: {
      fontSize: 9,
      textColor: secondaryColor,
    },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
    },
  });

  // Footer
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(0.5);
  doc.line(15, pageHeight - 15, pageWidth - 15, pageHeight - 15);

  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text(`${companyName} - MHR Calculation Report`, 15, pageHeight - 10);
  doc.text(`Generated on ${dateStr}`, pageWidth - 15, pageHeight - 10, { align: 'right' });

  // Save
  const fileName = `MHR-${record.machineName.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
};
