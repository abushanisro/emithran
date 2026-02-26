import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    console.log('📄 PDF extraction API called');
    const body = await request.json();
    const { pdfBuffer, fileName, balloonCoordinates } = body;
    console.log('📋 Request data:', { 
      pdfBufferLength: pdfBuffer?.length, 
      fileName, 
      balloonCoordinatesCount: balloonCoordinates?.length 
    });

    // If balloon coordinates are provided, extract dimensions at those exact locations
    if (balloonCoordinates && Array.isArray(balloonCoordinates)) {
      console.log('📄 Extracting dimensions at balloon coordinates:', balloonCoordinates.length);
      
      const buffer = Buffer.from(pdfBuffer);
      const dimensionData = await extractDimensionsAtCoordinates(buffer, balloonCoordinates, fileName);
      return NextResponse.json(dimensionData);
    }

    // Otherwise, extract text for potential manual selection (but don't auto-extract dimensions)
    if (!pdfBuffer || !Array.isArray(pdfBuffer)) {
      return NextResponse.json(
        { error: 'Invalid PDF buffer provided' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(pdfBuffer);
    console.log('📄 Buffer created, size:', buffer.length);
    
    if (buffer.length < 100) {
      return NextResponse.json(
        { error: 'PDF buffer too small, likely corrupted', size: buffer.length },
        { status: 400 }
      );
    }

    // Extract text for display/reference only - NO automatic dimension extraction
    let textContent = '';
    
    try {
      const PDFParser = require('pdf2json');
      const pdfParser = new PDFParser();
      
      const parsePromise = new Promise<string>((resolve, reject) => {
        pdfParser.on('pdfParser_dataError', (errData: any) => {
          console.error('📄 PDF2JSON Error:', errData.parserError);
          reject(new Error(errData.parserError));
        });
        
        pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
          try {
            let extractedText = '';
            
            if (pdfData.Pages && pdfData.Pages.length > 0) {
              for (const page of pdfData.Pages) {
                if (page.Texts && page.Texts.length > 0) {
                  const pageText = page.Texts
                    .map((textObj: any) => {
                      return textObj.R
                        .map((run: any) => decodeURIComponent(run.T))
                        .join(' ');
                    })
                    .join(' ');
                  
                  extractedText += pageText + '\n';
                }
              }
            }
            
            resolve(extractedText);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      pdfParser.parseBuffer(buffer);
      textContent = await parsePromise;
      
      console.log('📄 PDF parsed successfully, ready for manual dimension selection');
    } catch (parseError) {
      console.error('📄 PDF parse error:', parseError);
      throw new Error(`Failed to parse PDF: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }

    // Return empty table structure - user must manually add balloons
    return NextResponse.json({
      fileName,
      sampleCount: 5, // Max 5 samples
      inspectionRows: [],
      extractionMethod: 'manual-balloon-selection',
      message: 'PDF loaded successfully. Please manually add balloons to select dimensions for inspection.',
      textContent: textContent.substring(0, 1000) // First 1000 chars for reference
    });

  } catch (error) {
    console.error('Error extracting inspection table:', error);
    return NextResponse.json(
      { 
        error: 'Failed to process PDF',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

async function extractDimensionsAtCoordinates(buffer: Buffer, balloonCoordinates: any[], fileName: string) {
  console.log('📄 Starting coordinate-based dimension extraction');
  
  let pdfData: any = null;
  
  // Extract PDF structure with coordinates
  try {
    const PDFParser = require('pdf2json');
    const pdfParser = new PDFParser();
    
    const parsePromise = new Promise<any>((resolve, reject) => {
      pdfParser.on('pdfParser_dataError', (errData: any) => {
        reject(new Error(errData.parserError));
      });
      
      pdfParser.on('pdfParser_dataReady', (data: any) => {
        resolve(data);
      });
    });
    
    pdfParser.parseBuffer(buffer);
    pdfData = await parsePromise;
    console.log('📄 PDF parsed for coordinate extraction');
    
  } catch (error) {
    console.error('📄 PDF parsing failed:', error);
    throw new Error('Failed to parse PDF for coordinate extraction');
  }

  const inspectionRows = [];
  
  // Process each balloon coordinate
  for (let i = 0; i < balloonCoordinates.length; i++) {
    const balloon = balloonCoordinates[i];
    console.log(`📄 Processing balloon ${balloon.number} at coordinates (${balloon.x}, ${balloon.y})`);
    
    // Try multiple coordinate mapping approaches for better accuracy
    let dimensionText = '';
    
    // Method 1: Direct coordinates with small radius
    dimensionText = findTextNearCoordinates(pdfData, balloon.x, balloon.y, 15);
    
    // Method 2: If no text found, try scaled coordinates
    if (!dimensionText) {
      const scaledX = balloon.x * 0.75; // Try 75% scaling
      const scaledY = balloon.y * 0.75;
      dimensionText = findTextNearCoordinates(pdfData, scaledX, scaledY, 20);
      console.log(`📄 Trying scaled coordinates for balloon ${balloon.number}: (${scaledX}, ${scaledY})`);
    }
    
    // Method 3: If still no text found, try larger radius with original coordinates
    if (!dimensionText) {
      dimensionText = findTextNearCoordinates(pdfData, balloon.x, balloon.y, 40);
      console.log(`📄 Trying larger radius for balloon ${balloon.number}`);
    }
    console.log(`📄 Found text near balloon ${balloon.number}:`, dimensionText);
    
    if (dimensionText) {
      // Extract the actual dimension from the found text
      const dimension = extractDimensionFromText(dimensionText, balloon.number, balloonCoordinates.length);
      
      if (dimension) {
        inspectionRows.push(dimension);
        console.log(`📄 Extracted dimension for balloon ${balloon.number}:`, dimension);
      } else {
        // If no dimension found, mark as failed with reason
        inspectionRows.push({
          slNo: balloon.number.toString(),
          specification: 'Failed',
          nominal: 'FAILED',
          plusTol: 'N/A',
          minusTol: 'N/A',
          method: 'N/A',
          samples: Array(Math.min(5, balloonCoordinates.length)).fill('FAILED'), // Max 5 samples
          remarks: `Extraction failed - No dimension pattern found near balloon ${balloon.number}`,
          balloonNumber: balloon.number,
          coordinates: { x: balloon.x, y: balloon.y },
          extractedText: dimensionText,
          status: 'failed',
          failureReason: 'No recognizable dimension pattern found in nearby text'
        });
        console.log(`📄 Created placeholder for balloon ${balloon.number} - manual entry required`);
      }
    } else {
      // No text found near coordinates - mark as failed
      inspectionRows.push({
        slNo: balloon.number.toString(),
        specification: 'Failed',
        nominal: 'FAILED',
        plusTol: 'N/A',
        minusTol: 'N/A',
        method: 'N/A',
        samples: Array(Math.min(5, balloonCoordinates.length)).fill('FAILED'), // Max 5 samples
        remarks: `Extraction failed - No text found near balloon ${balloon.number} coordinates`,
        balloonNumber: balloon.number,
        coordinates: { x: balloon.x, y: balloon.y },
        status: 'failed',
        failureReason: 'No text detected within search radius of balloon coordinates'
      });
      console.log(`📄 No text found near balloon ${balloon.number} coordinates`);
    }
  }

  // Sort by balloon number
  inspectionRows.sort((a, b) => (a.balloonNumber || 0) - (b.balloonNumber || 0));

  const successfulExtractions = inspectionRows.filter(row => row.status !== 'failed').length;
  const failedExtractions = inspectionRows.filter(row => row.status === 'failed').length;

  return {
    fileName,
    sampleCount: Math.min(5, balloonCoordinates.length), // Max 5 samples
    inspectionRows,
    extractionMethod: 'coordinate-based-balloon-extraction',
    balloonsProcessed: balloonCoordinates.length,
    successfulExtractions: successfulExtractions,
    failedExtractions: failedExtractions,
    extractionSuccess: (successfulExtractions / balloonCoordinates.length) * 100,
    extractionSummary: {
      total: balloonCoordinates.length,
      successful: successfulExtractions,
      failed: failedExtractions,
      successRate: `${Math.round((successfulExtractions / balloonCoordinates.length) * 100)}%`
    }
  };
}

function findTextNearCoordinates(pdfData: any, targetX: number, targetY: number, radius: number): string {
  let nearbyText = [];
  
  if (!pdfData.Pages || pdfData.Pages.length === 0) return '';
  
  // Search through all pages
  for (const page of pdfData.Pages) {
    if (!page.Texts) continue;
    
    for (const textObj of page.Texts) {
      // Convert PDF coordinates - try different scaling approaches
      let textX, textY;
      
      // Method 1: Direct coordinate mapping (PDF units to drawing units)
      textX = (textObj.x || 0);
      textY = (textObj.y || 0);
      
      // Calculate distance from balloon to text
      const distance = Math.sqrt(Math.pow(textX - targetX, 2) + Math.pow(textY - targetY, 2));
      
      if (distance <= radius) {
        // Extract text content
        const text = textObj.R?.map((run: any) => decodeURIComponent(run.T)).join('') || '';
        if (text.trim()) {
          // Filter out non-dimensional text
          const cleanText = text.trim();
          if (isDimensionalText(cleanText)) {
            nearbyText.push({
              text: cleanText,
              distance: distance,
              x: textX,
              y: textY,
              priority: getPriorityScore(cleanText) // Add priority scoring
            });
          }
        }
      }
    }
  }
  
  // Sort by priority first (higher priority = main dimensions), then by distance
  nearbyText.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.distance - b.distance;
  });
  
  const dimensionalTexts = nearbyText.map(item => item.text);
  
  // Log for debugging with priority info
  console.log(`📄 Found ${nearbyText.length} dimensional text items near coordinates (${targetX}, ${targetY}):`);
  nearbyText.forEach(item => {
    console.log(`  - "${item.text}" (distance: ${item.distance.toFixed(2)}, priority: ${item.priority})`);
  });
  
  return dimensionalTexts.join(' ');
}

function getPriorityScore(text: string): number {
  // Priority scoring: higher score = more likely to be main dimension
  let score = 0;
  
  // High priority: Main dimensional values (multi-digit or significant decimal)
  if (/\d{2,}(?:\.\d+)?|\d+\.\d+/.test(text)) {
    const value = parseFloat(text.match(/\d+(?:\.\d+)?/)?.[0] || '0');
    if (value >= 1.0) score += 100; // Main dimensions are typically >= 1.0
    if (value >= 10.0) score += 50;  // Even higher for larger dimensions
  }
  
  // High priority: Diameter symbols
  if (/[⌀∅øØΦφ]/.test(text)) score += 80;
  
  // Medium-high priority: Complex toleranced dimensions
  if (/\d+(?:\.\d+)?\s*[+]\s*\d+(?:\.\d+)?\s*[-−]\s*\d+(?:\.\d+)?/.test(text)) score += 70;
  
  // Medium priority: Bilateral tolerances
  if (/\d+(?:\.\d+)?\s*[±]/.test(text)) score += 60;
  
  // Medium priority: Chamfer/angular
  if (/\d+(?:\.\d+)?\s*[xX×]\s*\d+(?:\.\d+)?\s*[°◦]/.test(text)) score += 60;
  
  // Lower priority: Small tolerance values (likely GD&T tolerances)
  if (/^0\.[0-9]{1,2}$/.test(text)) {
    const value = parseFloat(text);
    if (value <= 0.1) score -= 50; // Penalize small tolerance values
    if (value <= 0.05) score -= 100; // Heavy penalty for very small tolerances
  }
  
  // Very low priority: Pure small decimals without context
  if (/^0\.0[0-9]$/.test(text)) score -= 150;
  
  return score;
}

function isDimensionalText(text: string): boolean {
  // Filter out non-dimensional text
  const nonDimensionalPatterns = [
    /^(SHEET|DWG|TITLE|SCALE|REVISION|DATE|MATERIAL|FINISH|SIGNATURE|NAME)$/i,
    /^(A4|A3|A2|A1)$/i,
    /^(WITHOUT|THE|WRITTEN|PERMISSION|OF|FORUS|HEALTH|PVT|LTD|IS|PROHIBITED)$/i,
    /^(INFORMATION|CONTAINED|DRAWING|SOLE|PROPERTY|ANY|REPRODUCTION|PART|WHOLE)$/i,
    /^(DO|NOT|SCALE|DRAWING|NOTICE|Flash|Tube|Spacer|Aluminium|Black|Anodized)$/i,
    /^(DEBURR|AND|BREAK|SHARP|EDGES|SECTION|A-A)$/i,
    /^(UNLESS|OTHERWISE|SPECIFIED|DIMENSIONS|ARE|IN|MILLIMETERS)$/i,
    /^(SURFACE|TOLERANCES|LINEAR|ANGULAR|DRAWN|CHK'D|APPV'D|MFG|Q\.A)$/i,
    /^(HARISH|SRIDHAR|VENKAT)$/i,
    /^\d{2}-\d{2}-\d{2}$/,  // Dates like 28-04-21
    /^[A-Z]$/,              // Single letters like A, B, C, D
    /^\d+$/ // Pure numbers without decimal or tolerance (could be drawing numbers)
  ];
  
  // Check if text matches non-dimensional patterns
  for (const pattern of nonDimensionalPatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }
  
  // Look for dimensional indicators
  const dimensionalIndicators = [
    /\d+\.?\d*\s*[±]\s*\d+\.?\d*/,  // Toleranced dimensions
    /[⌀∅øØΦφ]\s*\d+\.?\d*/,        // Diameter symbols
    /R\s*\d+\.?\d*/,               // Radius
    /\d+\.?\d*\s*[xX×]\s*\d+\.?\d*\s*[°◦]/, // Chamfer
    /\d+\.?\d*\s*[°◦]/,            // Angular
    /\d+\.?\d*\s*[+]\s*\d+\.?\d*\s*\/?\s*[-−]\s*\d+\.?\d*/, // Complex tolerance
    /^\d+\.?\d*$/                  // Simple decimal numbers
  ];
  
  // Check if text contains dimensional indicators
  return dimensionalIndicators.some(pattern => pattern.test(text));
}

function extractDimensionFromText(text: string, balloonNumber: number, totalBalloons: number = 5): any | null {
  console.log(`📄 Analyzing text for balloon ${balloonNumber}: "${text}"`);
  
  // Enhanced dimension patterns based on engineering drawing standards
  // Sorted by priority: main dimensions first, then tolerances
  const patterns = [
    // Diameter with complex tolerance: "∅20 +0.10/-0.05", "∅21.5 +0.05/-0.10"  
    {
      regex: /[⌀∅øØΦφ]\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*\+\s*(\d+(?:\.\d+)?)\s*\/?\s*[-−]\s*(\d+(?:\.\d+)?)/,
      priority: 100,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        plusTol: `+${match[2]}`,
        minusTol: `-${match[3]}`,
        specification: 'Diameter',
        method: 'Micrometer',
        type: 'diameter_complex'
      })
    },
    // Linear complex toleranced dimensions: "20 +0.10 -0.05" (spaces between + and -)
    {
      regex: /(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*\+\s*(\d+(?:\.\d+)?)\s*[-−]\s*(\d+(?:\.\d+)?)/,
      priority: 95,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        plusTol: `+${match[2]}`,
        minusTol: `-${match[3]}`,
        specification: 'Linear Dimension',
        method: 'Caliper', 
        type: 'linear_complex'
      })
    },
    // Diameter with tolerance: "∅18 ±0.1", "∅15 ±0.05"
    {
      regex: /[⌀∅øØΦφ]\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*[±]\s*(\d+(?:\.\d+)?)/,
      priority: 90,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        plusTol: `+${match[2]}`,
        minusTol: `-${match[2]}`,
        specification: 'Diameter',
        method: 'Micrometer',
        type: 'diameter_toleranced'
      })
    },
    // Basic diameter: "∅35"
    {
      regex: /[⌀∅øØΦφ]\s*(\d+(?:\.\d+)?)/,
      priority: 85,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        specification: 'Diameter',
        method: 'Micrometer',
        type: 'diameter'
      })
    },
    // Chamfer/surface profile: "0.30 X 45°"
    {
      regex: /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[°◦]/,
      priority: 80,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        specification: 'Chamfer',
        method: 'Protractor/CMM',
        plusTol: '+0.1',
        minusTol: '-0.1',
        type: 'chamfer',
        additionalInfo: `${match[2]}°`
      })
    },
    // Linear dimension with tolerance: "1.5 ±0.05", "18 ±0.1"
    {
      regex: /(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*[±]\s*(\d+(?:\.\d+)?)/,
      priority: 75,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        plusTol: `+${match[2]}`,
        minusTol: `-${match[2]}`,
        specification: 'Linear Dimension',
        method: 'Caliper',
        type: 'linear_toleranced'
      })
    },
    // Radius: "R5.2"
    {
      regex: /R\s*(\d+(?:\.\d+)?)/,
      priority: 65,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        specification: 'Radius',
        method: 'Radius Gauge',
        type: 'radius'
      })
    },
    // Angular only: "45°"
    {
      regex: /(\d+(?:\.\d+)?)\s*[°◦]/,
      priority: 60,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        specification: 'Angular Dimension',
        method: 'Protractor/CMM',
        plusTol: '+0.5',
        minusTol: '-0.5',
        type: 'angular'
      })
    },
    // Surface finish: "Ra 3.2"
    {
      regex: /(?:Ra|Rz)\s*(\d+(?:\.\d+)?)/,
      priority: 55,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        specification: 'Surface Finish (Ra)',
        method: 'Surface Roughness Tester',
        plusTol: '+0',
        minusTol: '-0',
        type: 'surface'
      })
    },
    // Multi-digit or significant dimensions (prioritize over small tolerance values)
    {
      regex: /(\d{2,}(?:\.\d+)?|\d+\.\d+)/,
      priority: 50,
      extract: (match: RegExpMatchArray) => {
        const val = parseFloat(match[1]);
        // Only accept if it's a reasonable dimension (not a small tolerance like 0.05)
        if (val >= 1.0) {
          return {
            value: match[1],
            specification: 'Linear Dimension',
            method: 'Caliper',
            type: 'linear_main'
          };
        }
        return null;
      }
    },
    // Small precision values (tolerance/GD&T) - LOWEST PRIORITY
    {
      regex: /(0\.\d+)/,
      priority: 10,
      extract: (match: RegExpMatchArray) => ({
        value: match[1],
        specification: 'GD&T Tolerance',
        method: 'CMM',
        type: 'tolerance'
      })
    }
  ];

  // Sort patterns by priority (highest first) to prioritize main dimensions over tolerances
  patterns.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  // Try each pattern in priority order
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    if (match) {
      const extracted = pattern.extract(match);
      // Skip if extraction returned null (e.g., dimension too small)
      if (!extracted) continue;
      
      console.log(`📄 Pattern matched for balloon ${balloonNumber}:`, extracted);
      
      return {
        slNo: balloonNumber.toString(),
        specification: extracted.specification || 'Linear Dimension',
        nominal: extracted.value,
        plusTol: extracted.plusTol || '+0.1',
        minusTol: extracted.minusTol || '-0.1',
        method: extracted.method || 'Caliper',
        samples: Array(Math.min(5, totalBalloons)).fill(''), // Max 5 samples
        remarks: `Successfully extracted from balloon ${balloonNumber}: ${extracted.type}`,
        balloonNumber: balloonNumber,
        extractedText: text,
        dimensionType: extracted.type,
        status: 'success',
        extractedPattern: match[0]
      };
    }
  }

  console.log(`📄 No dimension pattern found for balloon ${balloonNumber}`);
  return null;
}

function parseInspectionTable(textContent: string, fileName: string) {
  console.log('📄 Starting comprehensive PDF analysis for:', fileName);
  console.log('📄 Text content length:', textContent.length);
  
  // Debug: Show first 500 chars of extracted text
  console.log('📄 First 500 chars of PDF text:', textContent.substring(0, 500));
  
  // Also show the full text for debugging (limited to 2000 chars)
  console.log('📄 Full PDF text (first 2000 chars):', textContent.substring(0, 2000));
  
  // First, try to extract from structured inspection tables
  const tableData = extractStructuredInspectionTable(textContent, fileName);
  if (tableData.inspectionRows.length > 0) {
    console.log('📄 Found structured inspection table with', tableData.inspectionRows.length, 'rows');
    return tableData;
  }

  // If no structured table, perform comprehensive dimension extraction
  console.log('📄 No structured table found, performing comprehensive dimension extraction');
  const dimensionData = extractComprehensiveDimensionData(textContent, fileName);
  
  // If still no results, try aggressive pattern matching
  if (dimensionData.inspectionRows.length === 0) {
    console.log('📄 No dimensions found, trying aggressive extraction');
    return extractAggressiveDimensionData(textContent, fileName);
  }
  
  return dimensionData;
}

function extractStructuredInspectionTable(textContent: string, fileName: string) {
  const inspectionRows: any[] = [];
  const lines = textContent.split(/[\n\r]+/).map(line => line.trim()).filter(line => line.length > 0);
  
  // Advanced table detection patterns for engineering drawings
  const tableHeaderPatterns = [
    /(?:item|sl\.?\s*no\.?|#)\s*(?:specification|description|dimension)\s*(?:nominal|size|target)\s*(?:tolerance|tol|limit)/i,
    /(?:characteristic|parameter)\s*(?:specification|requirement)\s*(?:value|measurement)\s*(?:tolerance|acceptance)/i,
    /(?:dimension|feature)\s*(?:requirement|spec)\s*(?:nominal|target)\s*(?:\+\/-|tolerance|limits)/i,
    /(?:check|inspection)\s*(?:point|item)\s*(?:standard|specification)\s*(?:measured|actual)/i
  ];

  let tableStart = -1;
  let headerStructure: string[] = [];
  
  // Find table header
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of tableHeaderPatterns) {
      if (pattern.test(line)) {
        tableStart = i;
        headerStructure = parseTableHeader(line);
        break;
      }
    }
    if (tableStart >= 0) break;
  }

  if (tableStart >= 0) {
    console.log('📄 Found structured table at line', tableStart);
    console.log('📄 Header structure:', headerStructure);
    
    // Parse table rows
    for (let i = tableStart + 1; i < lines.length && i < tableStart + 100; i++) {
      const line = lines[i];
      const rowData = parseStructuredTableRow(line, headerStructure, i - tableStart);
      
      if (rowData && isValidInspectionRow(rowData)) {
        inspectionRows.push(rowData);
      }
      
      // Stop at clear table end markers
      if (line.match(/^(?:total|summary|notes?|remarks?|end)/i) || 
          line.match(/^[-=]{10,}$/) ||
          inspectionRows.length >= 50) {
        break;
      }
    }
  }

  return {
    fileName,
    sampleCount: detectSampleCount(headerStructure),
    inspectionRows,
    extractionMethod: 'structured-table'
  };
}

function parseTableRow(line: string, sampleCount: number) {
  try {
    // Remove extra spaces and normalize
    const cleanLine = line.replace(/\s+/g, ' ').trim();
    
    // Split by common delimiters
    let parts = cleanLine.split(/[\t|,;]/).map(p => p.trim());
    
    // If not enough parts, try space splitting for specific patterns
    if (parts.length < 4) {
      // Look for number-heavy lines that might be data rows
      const numberPattern = /\d+[\.\d]*\s*/g;
      const numbers = cleanLine.match(numberPattern);
      
      if (numbers && numbers.length >= 3) {
        parts = cleanLine.split(/\s+/);
      }
    }

    // Must have at least: sl.no, specification, nominal, tolerances
    if (parts.length < 4) return null;

    // Try to identify parts
    let slNo = '';
    let specification = '';
    let nominal = '';
    let plusTol = '';
    let minusTol = '';
    let method = '';
    let samples: string[] = [];
    let remarks = '';

    // Pattern recognition for different table formats
    if (parts.length >= 6) {
      // Standard format: Sl.No | Spec | Nominal | +Tol | -Tol | Method | Samples... | Remarks
      slNo = parts[0];
      specification = parts[1];
      nominal = parts[2];
      plusTol = parts[3];
      minusTol = parts[4];
      method = parts[5];
      
      // Extract samples
      const startSampleIndex = 6;
      const endSampleIndex = Math.min(startSampleIndex + sampleCount, parts.length - 1);
      samples = parts.slice(startSampleIndex, endSampleIndex);
      
      // Remaining as remarks
      if (parts.length > endSampleIndex) {
        remarks = parts.slice(endSampleIndex).join(' ');
      }
    }

    // Validate that this looks like a data row
    const hasNumericData = [nominal, plusTol, minusTol, ...samples].some(val => 
      val && /\d/.test(val)
    );

    if (!hasNumericData) return null;

    // Clean up tolerances
    if (plusTol && !plusTol.startsWith('+') && !plusTol.startsWith('-')) {
      plusTol = '+' + plusTol;
    }
    if (minusTol && !minusTol.startsWith('-') && !minusTol.startsWith('+')) {
      minusTol = '-' + minusTol;
    }

    // Ensure we have the right number of samples
    while (samples.length < sampleCount) {
      samples.push('');
    }
    samples = samples.slice(0, sampleCount);

    return {
      slNo,
      specification: specification || 'Dimension',
      nominal: nominal || '',
      plusTol: plusTol || '+0.1',
      minusTol: minusTol || '-0.1',
      method: method || 'Caliper',
      samples,
      remarks: remarks || ''
    };

  } catch (error) {
    console.error('Error parsing table row:', line, error);
    return null;
  }
}

function extractComprehensiveDimensionData(textContent: string, fileName: string) {
  console.log('📄 Starting comprehensive dimension extraction');
  const inspectionRows: any[] = [];
  
  // Parse the entire document structure
  const documentStructure = analyzeDocumentStructure(textContent);
  console.log('📄 Document structure analysis complete');
  
  // Extract all dimensional elements
  const dimensions = extractAllDimensions(textContent, documentStructure);
  console.log('📄 Found', dimensions.length, 'dimensional elements');
  
  // Process each dimension with full context
  for (const dimension of dimensions) {
    console.log('📄 Processing dimension:', {
      type: dimension.type,
      value: dimension.value,
      rawText: dimension.rawText,
      context: dimension.context.substring(0, 100) + '...'
    });
    
    const inspectionRow = createInspectionRowFromDimension(dimension);
    if (inspectionRow) {
      console.log('📄 Created inspection row:', {
        slNo: inspectionRow.slNo,
        specification: inspectionRow.specification,
        nominal: inspectionRow.nominal,
        plusTol: inspectionRow.plusTol,
        minusTol: inspectionRow.minusTol,
        method: inspectionRow.method
      });
      inspectionRows.push(inspectionRow);
    }
  }
  
  // Sort by appearance order in document
  inspectionRows.sort((a, b) => (a.sourceIndex || 0) - (b.sourceIndex || 0));
  
  // Add sequential numbering
  inspectionRows.forEach((row, index) => {
    row.slNo = (index + 1).toString();
  });
  
  console.log('📄 Created', inspectionRows.length, 'inspection rows');
  
  return {
    fileName,
    sampleCount: determineSampleCount(textContent),
    inspectionRows,
    extractionMethod: 'comprehensive-dimension-extraction',
    documentAnalysis: {
      totalDimensions: dimensions.length,
      documentType: documentStructure.type,
      units: documentStructure.primaryUnit,
      drawingStandard: documentStructure.standard
    }
  };
}

function analyzeDocumentStructure(textContent: string) {
  const structure = {
    type: 'unknown',
    primaryUnit: 'mm',
    standard: 'ISO',
    titleBlock: {},
    revisions: [],
    notes: [],
    toleranceBlock: null,
    coordinateSystems: []
  };
  
  const lines = textContent.split(/[\n\r]+/).map(line => line.trim());
  
  // Detect document type
  const titleBlockIndicators = [
    /title\s*block/i,
    /drawing\s*(?:no|number)/i,
    /part\s*(?:no|number)/i,
    /sheet\s*\d+\s*of\s*\d+/i
  ];
  
  const assemblyIndicators = [
    /assembly/i,
    /asm\b/i,
    /exploded\s*view/i
  ];
  
  const detailIndicators = [
    /detail\s*[a-z]/i,
    /section\s*[a-z]-[a-z]/i,
    /view\s*[a-z]/i
  ];
  
  // Analyze content
  for (const line of lines) {
    // Detect primary units
    if (line.match(/(?:dimensions?\s*(?:are\s*)?in\s*millimeters?|mm\s*unless|metric)/i)) {
      structure.primaryUnit = 'mm';
    } else if (line.match(/(?:dimensions?\s*(?:are\s*)?in\s*inches?|"\s*unless)/i)) {
      structure.primaryUnit = 'inch';
    }
    
    // Detect drawing standard
    if (line.match(/(?:ansi|asme)/i)) structure.standard = 'ANSI';
    else if (line.match(/iso/i)) structure.standard = 'ISO';
    else if (line.match(/din/i)) structure.standard = 'DIN';
    else if (line.match(/jis/i)) structure.standard = 'JIS';
    
    // Detect document type
    if (titleBlockIndicators.some(pattern => pattern.test(line))) {
      structure.type = 'engineering_drawing';
    } else if (assemblyIndicators.some(pattern => pattern.test(line))) {
      structure.type = 'assembly_drawing';
    } else if (detailIndicators.some(pattern => pattern.test(line))) {
      structure.type = 'detail_drawing';
    }
  }
  
  return structure;
}

function extractAllDimensions(textContent: string, structure: any) {
  const dimensions: any[] = [];
  
  // Comprehensive dimension patterns for engineering drawings
  const dimensionPatterns = [
    // Linear dimensions with tolerances - enhanced pattern
    {
      pattern: /(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|ft|"|\′|′′)?\s*(?:[±]\s*(\d+(?:\.\d+)?)|[+]\s*(\d+(?:\.\d+)?)\s*[-−]\s*(\d+(?:\.\d+)?))/g,
      type: 'linear_toleranced',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        plusTolerance: match[3] ? parseFloat(match[3]) : (match[2] ? parseFloat(match[2]) : 0),
        minusTolerance: match[4] ? parseFloat(match[4]) : (match[2] ? parseFloat(match[2]) : 0),
        unit: detectUnit(match[0], structure.primaryUnit),
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100)
      })
    },
    
    // Complex tolerance patterns (e.g., "20 + + 0.10 0.05", "21.5 - - 0.05 0.10")
    {
      pattern: /(\d+(?:\.\d+)?)\s*[+]\s*[+]\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*[-]\s*[-]\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/g,
      type: 'complex_toleranced',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1] || match[4]),
        plusTolerance: match[1] ? parseFloat(match[2]) : 0,
        minusTolerance: match[4] ? parseFloat(match[5]) : 0,
        unit: detectUnit(match[0], structure.primaryUnit),
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100)
      })
    },
    
    // Standalone dimensions without explicit tolerances
    {
      pattern: /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|ft|"|\′|′′)?(?=\s|$)/g,
      type: 'basic_dimension',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        plusTolerance: 0,
        minusTolerance: 0,
        unit: detectUnit(match[0], structure.primaryUnit),
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100)
      })
    },
    
    // Diameter dimensions
    {
      pattern: /[⌀∅øØΦφ]\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|ft|"|\′|′′)?\s*(?:[±]\s*(\d+(?:\.\d+)?)|[+]\s*(\d+(?:\.\d+)?)\s*[-−]\s*(\d+(?:\.\d+)?))?/g,
      type: 'diameter',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        plusTolerance: match[3] ? parseFloat(match[3]) : (match[2] ? parseFloat(match[2]) : 0),
        minusTolerance: match[4] ? parseFloat(match[4]) : (match[2] ? parseFloat(match[2]) : 0),
        unit: detectUnit(match[0], structure.primaryUnit),
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'diameter'
      })
    },
    
    // Radius dimensions
    {
      pattern: /R\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|ft|"|\′|′′)?\s*(?:[±]\s*(\d+(?:\.\d+)?)|[+]\s*(\d+(?:\.\d+)?)\s*[-−]\s*(\d+(?:\.\d+)?))?/g,
      type: 'radius',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        plusTolerance: match[3] ? parseFloat(match[3]) : (match[2] ? parseFloat(match[2]) : 0),
        minusTolerance: match[4] ? parseFloat(match[4]) : (match[2] ? parseFloat(match[2]) : 0),
        unit: detectUnit(match[0], structure.primaryUnit),
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'radius'
      })
    },
    
    // Angular dimensions
    {
      pattern: /(\d+(?:\.\d+)?)\s*[°◦]\s*(?:[±]\s*(\d+(?:\.\d+)?)\s*[°◦]?|[+]\s*(\d+(?:\.\d+)?)\s*[°◦]?\s*[-−]\s*(\d+(?:\.\d+)?)\s*[°◦]?)?/g,
      type: 'angular',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        plusTolerance: match[3] ? parseFloat(match[3]) : (match[2] ? parseFloat(match[2]) : 0),
        minusTolerance: match[4] ? parseFloat(match[4]) : (match[2] ? parseFloat(match[2]) : 0),
        unit: 'degree',
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'angle'
      })
    },
    
    // Thread specifications
    {
      pattern: /(?:M(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)|(\d+(?:\/\d+)?)\s*[-−]\s*(\d+)\s*(UNC|UNF|UNEF|NPT|BSP))/g,
      type: 'thread',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: match[1] ? parseFloat(match[1]) : match[3],
        pitch: match[2] ? parseFloat(match[2]) : match[4],
        threadType: match[5] || 'metric',
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'thread'
      })
    },
    
    // GD&T Feature Control Frames
    {
      pattern: /([⌖⊥∥⌒⏸⌯⌾○◎])\s*(\d+(?:\.\d+)?)\s*(?:[ⓂⓁ])?\s*([A-Z](?:\|[A-Z])*)?/g,
      type: 'gdt',
      extract: (match: RegExpMatchArray, index: number) => ({
        gdtSymbol: match[1],
        value: parseFloat(match[2]),
        datumReferences: match[3] ? match[3].split('|') : [],
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'gdt_tolerance'
      })
    },
    
    // Surface finish and roughness
    {
      pattern: /(?:Ra|Rz|Rq|Rt)?\s*(\d+(?:\.\d+)?)\s*(?:μm|µm|um|μin|µin)?/g,
      type: 'surface_finish',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        parameter: match[0].match(/Ra|Rz|Rq|Rt/)?.[0] || 'Ra',
        unit: match[0].includes('μin') || match[0].includes('µin') ? 'microinch' : 'micrometer',
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'surface_finish'
      })
    },
    
    // GD&T with datum references (e.g., "0.05 D")
    {
      pattern: /(\d+(?:\.\d+)?)\s*([A-Z])\s*(?:max|min)?/g,
      type: 'gdt_datum',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        datumRef: match[2],
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'gdt_tolerance'
      })
    },
    
    // Edge break and chamfer (e.g., "0.2 max")
    {
      pattern: /(\d+(?:\.\d+)?)\s*(?:max|min)\s*(?:edge|break|chamfer)?/g,
      type: 'edge_break',
      extract: (match: RegExpMatchArray, index: number) => ({
        value: parseFloat(match[1]),
        constraint: match[0].includes('max') ? 'maximum' : 'minimum',
        rawText: match[0],
        sourceIndex: index,
        context: extractContext(textContent, match.index || 0, 100),
        feature: 'edge_break'
      })
    }
  ];
  
  // Extract dimensions using all patterns
  dimensionPatterns.forEach(patternObj => {
    let match;
    let index = 0;
    while ((match = patternObj.pattern.exec(textContent)) !== null) {
      const dimension = patternObj.extract(match, index++);
      dimension.type = patternObj.type;
      dimensions.push(dimension);
    }
  });
  
  return dimensions;
}

function getSpecificationFromContext(context: string, patternType: string, matchText: string): string {
  // Priority-based specification detection including GD&T
  if (patternType === 'gdt') {
    // GD&T symbol detection
    if (matchText.includes('⌖')) return 'Position Tolerance';
    if (matchText.includes('⊥')) return 'Perpendicularity';
    if (matchText.includes('∥')) return 'Parallelism';
    if (matchText.includes('⌒')) return 'Surface Profile';
    if (matchText.includes('⏸')) return 'Flatness';
    if (matchText.includes('⌯')) return 'Concentricity';
    if (matchText.includes('⌾')) return 'Circular Runout';
    return 'GD&T Tolerance';
  }
  
  if (patternType === 'positional') {
    return 'Position Tolerance';
  }
  
  if (patternType === 'concentricity') {
    return 'Concentricity/Coaxiality';
  }
  
  if (patternType === 'surface_finish') {
    return 'Surface Finish';
  }
  
  if (patternType === 'angle') {
    return 'Angular Dimension';
  }
  
  if (context.includes('diameter') || context.includes('⌀') || context.includes('∅') || context.includes('ø') || patternType === 'diameter') {
    return 'Diameter';
  }
  
  if (context.includes('radius') || context.includes('rad') || patternType === 'radius') {
    return 'Radius';
  }
  
  if (context.includes('thread') || context.includes('screw') || context.includes('unc') || context.includes('unf') || patternType === 'thread') {
    return 'Thread Dimension';
  }
  
  if (context.includes('hole') || context.includes('drill') || context.includes('bore') || context.includes('cbore') || context.includes('csink') || patternType === 'hole') {
    return 'Hole Diameter';
  }
  
  if (context.includes('length') || context.includes('long')) {
    return 'Length';
  }
  if (context.includes('width') || context.includes('wide')) {
    return 'Width';
  }
  if (context.includes('height') || context.includes('tall')) {
    return 'Height';
  }
  if (context.includes('thickness') || context.includes('thick')) {
    return 'Thickness';
  }
  if (context.includes('depth') || context.includes('deep')) {
    return 'Depth';
  }
  if (context.includes('distance') || context.includes('spacing')) {
    return 'Distance';
  }
  if (context.includes('angle') || context.includes('deg') || context.includes('°')) {
    return 'Angular Dimension';
  }
  if (context.includes('chamfer')) {
    return 'Chamfer';
  }
  if (context.includes('fillet')) {
    return 'Fillet Radius';
  }
  if (context.includes('finish') || context.includes('surface') || context.includes('ra') || context.includes('rz')) {
    return 'Surface Finish';
  }
  if (context.includes('position') || context.includes('true position')) {
    return 'Position Tolerance';
  }
  if (context.includes('flatness')) {
    return 'Flatness';
  }
  if (context.includes('parallel')) {
    return 'Parallelism';
  }
  if (context.includes('perpendicular')) {
    return 'Perpendicularity';
  }
  if (context.includes('runout')) {
    return 'Runout';
  }
  
  return 'Dimension';
}

function getContextualRemarks(context: string): string {
  const remarks: string[] = [];
  
  if (context.includes('critical') || context.includes('important')) {
    remarks.push('Critical dimension');
  }
  if (context.includes('finish') || context.includes('surface')) {
    remarks.push('Surface finish critical');
  }
  if (context.includes('match') || context.includes('mate')) {
    remarks.push('Mating dimension');
  }
  if (context.includes('reference') || context.includes('ref')) {
    remarks.push('Reference only');
  }
  
  return remarks.join(', ');
}

function extractAggressiveDimensionData(textContent: string, fileName: string) {
  console.log('📄 Starting aggressive dimension extraction');
  const inspectionRows: any[] = [];
  let rowIndex = 1;
  
  // Split text into words and analyze each section
  const words = textContent.split(/\s+/).filter(word => word.length > 0);
  const lines = textContent.split(/[\n\r]+/).map(line => line.trim()).filter(line => line.length > 0);
  
  console.log('📄 Total words:', words.length, 'Total lines:', lines.length);
  
  // Comprehensive patterns to catch ALL possible dimensions
  const aggressivePatterns = [
    // Any number with any tolerance format
    /(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|inch|"|\′|′′)?\s*(?:[±]\s*(\d+(?:\.\d+)?)|[+]\s*(\d+(?:\.\d+)?)\s*[-−]\s*(\d+(?:\.\d+)?)|[+](\d+(?:\.\d+)?)\s*[-−](\d+(?:\.\d+)?))/g,
    
    // Diameter symbols with numbers
    /[⌀∅øØΦφDd]\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|inch|"|\′|′′)?/g,
    
    // R followed by number (radius)
    /R\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|inch|"|\′|′′)?/g,
    
    // Any angle
    /(\d+(?:\.\d+)?)\s*[°◦deg]/g,
    
    // Thread patterns
    /M\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/g,
    /(\d+(?:\/\d+)?)\s*[-−]\s*(\d+)\s*(?:UNC|UNF|UNEF|NPT|BSP)/g,
    
    // Surface finish
    /(?:Ra|Rz|Rq|Rt)\s*(\d+(?:\.\d+)?)/g,
    
    // Any standalone number that could be a dimension
    /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|inch|"|\′|′′)(?:\s|$)/g,
    
    // Numbers in parentheses or brackets
    /[(\[]\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|m|in|inch|"|\′|′′)?\s*[)\]]/g,
    
    // Decimal numbers alone (last resort)
    /(?:^|\s)(\d+\.\d+)(?:\s|$)/g,
    
    // Integer numbers that could be dimensions (3+ digits or specific contexts)
    /(?:length|width|height|diameter|radius|thickness|depth|distance|size|dimension)[\s:]*(\d+(?:\.\d+)?)/gi
  ];
  
  const extractedNumbers = new Set<string>();
  
  // Extract using all patterns
  for (const pattern of aggressivePatterns) {
    let match;
    while ((match = pattern.exec(textContent)) !== null) {
      const value = match[1];
      if (value && !extractedNumbers.has(value)) {
        extractedNumbers.add(value);
        
        const contextStart = Math.max(0, match.index - 50);
        const contextEnd = Math.min(textContent.length, match.index + match[0].length + 50);
        const context = textContent.substring(contextStart, contextEnd);
        
        const specification = determineSpecificationFromContext(context, match[0]);
        const method = determineMethodFromSpecification(specification);
        
        // Extract tolerances if present
        let plusTol = '+0.1';
        let minusTol = '-0.1';
        
        if (match[2]) {
          // ± format
          plusTol = `+${match[2]}`;
          minusTol = `-${match[2]}`;
        } else if (match[3] && match[4]) {
          // +/- format  
          plusTol = `+${match[3]}`;
          minusTol = `-${match[4]}`;
        } else if (match[5] && match[6]) {
          // Alternative +/- format
          plusTol = `+${match[5]}`;
          minusTol = `-${match[6]}`;
        } else {
          // Apply intelligent tolerance based on value
          const tolerance = getIntelligentTolerance(parseFloat(value), specification);
          plusTol = `+${tolerance}`;
          minusTol = `-${tolerance}`;
        }
        
        const remarks = buildRemarksFromContext(context, match[0]);
        
        inspectionRows.push({
          slNo: rowIndex.toString(),
          specification,
          nominal: value,
          plusTol,
          minusTol,
          method,
          samples: Array(5).fill(''), // Max 5 samples
          remarks,
          sourceText: match[0],
          context: context.trim()
        });
        
        rowIndex++;
        
        console.log(`📄 Extracted: ${specification} = ${value} (${plusTol}/${minusTol}) from "${match[0]}"`);
      }
    }
  }
  
  // Also extract from tabular data patterns
  for (const line of lines) {
    // Look for lines that might contain dimensional data
    if (line.match(/\d+(?:\.\d+)?/) && line.length > 10) {
      const numbers = line.match(/\d+(?:\.\d+)?/g);
      if (numbers && numbers.length >= 1) {
        const mainValue = numbers[0];
        if (!extractedNumbers.has(mainValue) && parseFloat(mainValue) > 0) {
          extractedNumbers.add(mainValue);
          
          const specification = determineSpecificationFromContext(line, line);
          const method = determineMethodFromSpecification(specification);
          
          inspectionRows.push({
            slNo: rowIndex.toString(),
            specification,
            nominal: mainValue,
            plusTol: '+0.1',
            minusTol: '-0.1',
            method,
            samples: Array(5).fill(''), // Max 5 samples
            remarks: 'Extracted from tabular data',
            sourceText: line.substring(0, 50),
            context: line
          });
          
          rowIndex++;
          
          console.log(`📄 Table extracted: ${specification} = ${mainValue} from line "${line.substring(0, 50)}..."`);
        }
      }
    }
  }
  
  console.log('📄 Aggressive extraction complete:', inspectionRows.length, 'dimensions found');
  
  return {
    fileName,
    sampleCount: Math.min(5, inspectionRows.length), // Max 5 samples
    inspectionRows,
    extractionMethod: 'aggressive-extraction',
    debugInfo: {
      totalWords: words.length,
      totalLines: lines.length,
      extractedNumbers: Array.from(extractedNumbers).length,
      firstFewLines: lines.slice(0, 10)
    }
  };
}

function determineSpecificationFromContext(context: string, match: string): string {
  const ctx = context.toLowerCase();
  const matchLower = match.toLowerCase();
  
  // GD&T symbols
  if (match.includes('⌖')) return 'Position Tolerance';
  if (match.includes('⊥')) return 'Perpendicularity';
  if (match.includes('∥')) return 'Parallelism';
  if (match.includes('⌒')) return 'Surface Profile';
  if (match.includes('⏸')) return 'Flatness';
  if (match.includes('⌯')) return 'Concentricity';
  if (match.includes('⌾')) return 'Circular Runout';
  
  // Feature type detection
  if (matchLower.includes('⌀') || matchLower.includes('∅') || matchLower.includes('ø') || 
      ctx.includes('diameter') || ctx.includes('bore') || ctx.includes('hole')) {
    return 'Diameter';
  }
  
  if (matchLower.startsWith('r') || ctx.includes('radius') || ctx.includes('fillet')) {
    return 'Radius';
  }
  
  if (matchLower.includes('°') || matchLower.includes('deg') || ctx.includes('angle')) {
    return 'Angular Dimension';
  }
  
  if (matchLower.includes('m') && matchLower.includes('x')) {
    return 'Metric Thread';
  }
  
  if (matchLower.includes('unc') || matchLower.includes('unf') || matchLower.includes('npt')) {
    return 'Imperial Thread';
  }
  
  if (ctx.includes('ra ') || ctx.includes('rz ') || ctx.includes('surface') || ctx.includes('finish')) {
    return 'Surface Finish';
  }
  
  // Dimensional context
  if (ctx.includes('length') || ctx.includes('long')) return 'Length';
  if (ctx.includes('width') || ctx.includes('wide')) return 'Width';
  if (ctx.includes('height') || ctx.includes('tall') || ctx.includes('high')) return 'Height';
  if (ctx.includes('thickness') || ctx.includes('thick')) return 'Thickness';
  if (ctx.includes('depth') || ctx.includes('deep')) return 'Depth';
  if (ctx.includes('distance') || ctx.includes('spacing')) return 'Distance';
  if (ctx.includes('chamfer')) return 'Chamfer';
  
  return 'Linear Dimension';
}

function determineMethodFromSpecification(specification: string): string {
  const spec = specification.toLowerCase();
  
  if (spec.includes('position') || spec.includes('concentricity') || spec.includes('runout') ||
      spec.includes('perpendicularity') || spec.includes('parallelism') || spec.includes('flatness')) {
    return 'CMM';
  }
  
  if (spec.includes('surface') || spec.includes('finish')) {
    return 'Surface Roughness Tester';
  }
  
  if (spec.includes('angular') || spec.includes('angle')) {
    return 'Protractor/CMM';
  }
  
  if (spec.includes('diameter') || spec.includes('bore') || spec.includes('hole')) {
    return 'Micrometer';
  }
  
  if (spec.includes('radius')) {
    return 'Radius Gauge';
  }
  
  if (spec.includes('thread')) {
    return 'Thread Gauge';
  }
  
  if (spec.includes('thickness')) {
    return 'Micrometer';
  }
  
  return 'Caliper';
}

function getIntelligentTolerance(value: number, specification: string): number {
  const spec = specification.toLowerCase();
  
  // GD&T tolerances are typically much tighter
  if (spec.includes('position') || spec.includes('concentricity') || spec.includes('runout') ||
      spec.includes('perpendicularity') || spec.includes('parallelism') || spec.includes('flatness')) {
    if (value < 1) return 0.01;
    if (value < 10) return 0.05;
    return 0.1;
  }
  
  // Surface finish uses different scale
  if (spec.includes('surface') || spec.includes('finish')) {
    return value * 0.1; // 10% tolerance for surface finish
  }
  
  // Angular tolerances
  if (spec.includes('angular') || spec.includes('angle')) {
    return value < 90 ? 0.5 : 1.0;
  }
  
  // Standard dimensional tolerances (ISO 2768 medium)
  if (value <= 6) return 0.1;
  if (value <= 30) return 0.2;
  if (value <= 120) return 0.3;
  if (value <= 400) return 0.5;
  return 1.0;
}

function buildRemarksFromContext(context: string, match: string): string {
  const remarks: string[] = [];
  const ctx = context.toLowerCase();
  
  // Add source information
  if (match.includes('⌖') || match.includes('⊥') || match.includes('∥') || 
      match.includes('⌒') || match.includes('⏸') || match.includes('⌯') || match.includes('⌾')) {
    remarks.push('GD&T tolerance');
  }
  
  if (ctx.includes('critical') || ctx.includes('key') || ctx.includes('important')) {
    remarks.push('Critical dimension');
  }
  
  if (ctx.includes('reference') || ctx.includes('ref') || ctx.includes('basic')) {
    remarks.push('Reference only');
  }
  
  if (ctx.includes('machined') || ctx.includes('machine') || ctx.includes('mill') || 
      ctx.includes('turn') || ctx.includes('drill')) {
    remarks.push('Machined feature');
  }
  
  if (ctx.includes('assembly') || ctx.includes('mate') || ctx.includes('interface')) {
    remarks.push('Assembly interface');
  }
  
  if (ctx.includes('hole') || ctx.includes('bore') || ctx.includes('drill')) {
    remarks.push('Hole feature');
  }
  
  if (ctx.includes('thread') || ctx.includes('tap') || ctx.includes('screw')) {
    remarks.push('Threaded feature');
  }
  
  return remarks.length > 0 ? remarks.join(', ') : '';
}

// Utility functions for comprehensive extraction

function parseTableHeader(headerLine: string): string[] {
  // Parse table header to understand column structure
  const columns = headerLine.split(/\s{3,}|\t+|;|,/).map(col => col.trim()).filter(col => col.length > 0);
  return columns;
}

function parseStructuredTableRow(line: string, headerStructure: string[], rowNumber: number): any | null {
  // Parse a row based on detected header structure
  const cells = line.split(/\s{3,}|\t+|;|,/).map(cell => cell.trim()).filter(cell => cell.length > 0);
  
  if (cells.length < 3) return null; // Need at least 3 columns for meaningful data
  
  const row: any = {
    slNo: cells[0] || rowNumber.toString(),
    specification: cells[1] || 'Unknown',
    nominal: extractNumericValue(cells[2]) || '',
    plusTol: extractPlusTolerance(cells[3]) || '+0.1',
    minusTol: extractMinusTolerance(cells[3]) || '-0.1',
    method: determineMethod(cells[1] || ''),
    samples: [],
    remarks: cells.slice(4).join(' ') || ''
  };
  
  // Extract sample data if present
  for (let i = 4; i < Math.min(cells.length, 9); i++) {
    const sampleValue = extractNumericValue(cells[i]);
    if (sampleValue) {
      row.samples.push(sampleValue);
    }
  }
  
  return row;
}

function isValidInspectionRow(row: any): boolean {
  return row && 
         row.specification && 
         row.specification.length > 0 && 
         row.nominal && 
         row.nominal.length > 0 &&
         !row.specification.toLowerCase().includes('total') &&
         !row.specification.toLowerCase().includes('summary');
}

function detectSampleCount(headerStructure: string[]): number {
  const sampleColumns = headerStructure.filter(header => 
    header.toLowerCase().includes('sample') || 
    header.toLowerCase().includes('measurement') ||
    /sample\s*\d+/i.test(header)
  );
  return Math.max(sampleColumns.length, 5); // Default to 5 if not detected
}

function determineSampleCount(textContent: string): number {
  // Look for sample count indicators in the text
  const sampleMatches = textContent.match(/(?:sample|measurement)\s*(?:size|count|number)?\s*[:=]?\s*(\d+)/gi);
  if (sampleMatches && sampleMatches.length > 0) {
    const numbers = sampleMatches.map(match => {
      const num = match.match(/\d+/);
      return num ? parseInt(num[0]) : 5;
    });
    return Math.max(...numbers, 5);
  }
  return 5; // Default sample count
}

function extractContext(text: string, position: number, radius: number): string {
  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  return text.substring(start, end).trim();
}

function detectUnit(dimensionText: string, primaryUnit: string): string {
  if (dimensionText.includes('mm') || dimensionText.includes('millimeter')) return 'mm';
  if (dimensionText.includes('cm') || dimensionText.includes('centimeter')) return 'cm';
  if (dimensionText.includes('m') && !dimensionText.includes('mm')) return 'm';
  if (dimensionText.includes('in') || dimensionText.includes('"') || dimensionText.includes('inch')) return 'inch';
  if (dimensionText.includes('ft') || dimensionText.includes('foot')) return 'ft';
  return primaryUnit; // Default to primary unit
}

function extractNumericValue(text: string): string {
  const match = text.match(/(\d+(?:\.\d+)?)/);
  return match ? match[1] : '';
}

function extractPlusTolerance(text: string): string {
  const match = text.match(/[+]\s*(\d+(?:\.\d+)?)|[±]\s*(\d+(?:\.\d+)?)/);
  return match ? `+${match[1] || match[2]}` : '';
}

function extractMinusTolerance(text: string): string {
  const plusMinusMatch = text.match(/[+]\s*(\d+(?:\.\d+)?)\s*[-−]\s*(\d+(?:\.\d+)?)/);
  if (plusMinusMatch) return `-${plusMinusMatch[2]}`;
  
  const biMatch = text.match(/[±]\s*(\d+(?:\.\d+)?)/);
  return biMatch ? `-${biMatch[1]}` : '';
}

function determineMethod(specification: string): string {
  const spec = specification.toLowerCase();
  
  if (spec.includes('position') || spec.includes('concentricity') || spec.includes('runout')) return 'CMM';
  if (spec.includes('surface') || spec.includes('finish') || spec.includes('roughness')) return 'Surface Roughness Tester';
  if (spec.includes('angle') || spec.includes('angular')) return 'Protractor/CMM';
  if (spec.includes('flatness') || spec.includes('straightness')) return 'Surface Plate/CMM';
  if (spec.includes('diameter') || spec.includes('bore') || spec.includes('hole')) return 'Micrometer';
  if (spec.includes('radius')) return 'Radius Gauge';
  if (spec.includes('thread')) return 'Thread Gauge';
  if (spec.includes('thickness') || spec.includes('thin')) return 'Micrometer';
  if (spec.includes('length') || spec.includes('width') || spec.includes('height')) return 'Caliper';
  
  return 'Caliper'; // Default measurement method
}

function createInspectionRowFromDimension(dimension: any): any | null {
  if (!dimension || !dimension.value) return null;
  
  const specification = getSpecificationFromDimension(dimension);
  const method = getMethodFromDimension(dimension);
  
  let plusTol = '';
  let minusTol = '';
  
  if (dimension.type === 'gdt') {
    plusTol = `±${dimension.value}`;
    minusTol = '';
  } else if (dimension.plusTolerance !== undefined && dimension.minusTolerance !== undefined) {
    plusTol = `+${dimension.plusTolerance}`;
    minusTol = `-${dimension.minusTolerance}`;
  } else {
    // Apply standard tolerances based on dimension size
    const stdTol = getStandardTolerance(dimension.value, dimension.unit);
    plusTol = `+${stdTol}`;
    minusTol = `-${stdTol}`;
  }
  
  const remarks = buildRemarksFromDimension(dimension);
  
  return {
    specification,
    nominal: dimension.value.toString(),
    plusTol,
    minusTol,
    method,
    samples: Array(5).fill(''),
    remarks,
    sourceIndex: dimension.sourceIndex,
    unit: dimension.unit,
    rawText: dimension.rawText,
    dimensionType: dimension.type
  };
}

function getSpecificationFromDimension(dimension: any): string {
  switch (dimension.type) {
    case 'diameter': return 'Diameter';
    case 'radius': return 'Radius';
    case 'angular': return 'Angular Dimension';
    case 'thread': return dimension.threadType === 'metric' ? 'Metric Thread' : 'Imperial Thread';
    case 'gdt': return getGDTSpecification(dimension.gdtSymbol);
    case 'gdt_datum': return `GD&T Tolerance (Datum ${dimension.datumRef})`;
    case 'surface_finish': return `Surface Finish (${dimension.parameter})`;
    case 'edge_break': return 'Edge Break/Chamfer';
    case 'complex_toleranced': return determineLegacySpecificationFromContext(dimension.context);
    case 'basic_dimension': return determineLegacySpecificationFromContext(dimension.context);
    case 'linear_toleranced': return determineLegacySpecificationFromContext(dimension.context);
    default: return 'Linear Dimension';
  }
}

function getGDTSpecification(symbol: string): string {
  const gdtMap: { [key: string]: string } = {
    '⌖': 'Position Tolerance',
    '⊥': 'Perpendicularity',
    '∥': 'Parallelism',
    '⌒': 'Surface Profile',
    '⏸': 'Flatness',
    '⌯': 'Concentricity',
    '⌾': 'Circular Runout',
    '○': 'Circular Runout',
    '◎': 'Total Runout'
  };
  return gdtMap[symbol] || 'GD&T Tolerance';
}

function getMethodFromDimension(dimension: any): string {
  switch (dimension.type) {
    case 'diameter': return 'Micrometer';
    case 'radius': return 'Radius Gauge';
    case 'angular': return 'Protractor/CMM';
    case 'thread': return 'Thread Gauge';
    case 'gdt': return 'CMM';
    case 'surface_finish': return 'Surface Roughness Tester';
    default: return 'Caliper';
  }
}

function getStandardTolerance(value: number, unit: string): number {
  // Apply standard tolerance based on ISO 2768 or similar
  if (unit === 'mm') {
    if (value <= 6) return 0.1;
    if (value <= 30) return 0.2;
    if (value <= 120) return 0.3;
    if (value <= 400) return 0.5;
    return 1.0;
  } else if (unit === 'inch') {
    if (value <= 0.5) return 0.005;
    if (value <= 2) return 0.01;
    if (value <= 6) return 0.015;
    return 0.025;
  }
  return 0.1; // Default
}

function buildRemarksFromDimension(dimension: any): string {
  const remarks: string[] = [];
  
  if (dimension.gdtSymbol) {
    remarks.push(`GD&T: ${dimension.gdtSymbol}`);
  }
  
  if (dimension.datumReferences && dimension.datumReferences.length > 0) {
    remarks.push(`Datum: ${dimension.datumReferences.join('|')}`);
  }
  
  if (dimension.threadType && dimension.threadType !== 'metric') {
    remarks.push(`Thread: ${dimension.threadType}`);
  }
  
  if (dimension.parameter && dimension.type === 'surface_finish') {
    remarks.push(`Parameter: ${dimension.parameter}`);
  }
  
  // Add context-based remarks
  const contextRemarks = analyzeContextForRemarks(dimension.context);
  if (contextRemarks) {
    remarks.push(contextRemarks);
  }
  
  return remarks.join(', ');
}

function determineLegacySpecificationFromContext(context: string): string {
  const ctx = context.toLowerCase();
  
  if (ctx.includes('diameter') || ctx.includes('⌀') || ctx.includes('∅')) return 'Diameter';
  if (ctx.includes('radius') || ctx.includes('rad')) return 'Radius';
  if (ctx.includes('length') || ctx.includes('long')) return 'Length';
  if (ctx.includes('width') || ctx.includes('wide')) return 'Width';
  if (ctx.includes('height') || ctx.includes('tall') || ctx.includes('high')) return 'Height';
  if (ctx.includes('thickness') || ctx.includes('thick')) return 'Thickness';
  if (ctx.includes('depth') || ctx.includes('deep')) return 'Depth';
  if (ctx.includes('hole') || ctx.includes('bore')) return 'Hole Diameter';
  if (ctx.includes('distance') || ctx.includes('spacing')) return 'Distance';
  if (ctx.includes('chamfer')) return 'Chamfer';
  if (ctx.includes('fillet')) return 'Fillet Radius';
  
  return 'Linear Dimension';
}

function analyzeContextForRemarks(context: string): string {
  const remarks: string[] = [];
  const ctx = context.toLowerCase();
  
  if (ctx.includes('critical') || ctx.includes('key') || ctx.includes('important')) {
    remarks.push('Critical dimension');
  }
  
  if (ctx.includes('reference') || ctx.includes('ref') || ctx.includes('basic')) {
    remarks.push('Reference only');
  }
  
  if (ctx.includes('machined') || ctx.includes('machine')) {
    remarks.push('Machined surface');
  }
  
  if (ctx.includes('mating') || ctx.includes('interface') || ctx.includes('assembly')) {
    remarks.push('Mating dimension');
  }
  
  if (ctx.includes('drill') || ctx.includes('tap') || ctx.includes('ream')) {
    remarks.push('Machining operation');
  }
  
  return remarks.join(', ');
}