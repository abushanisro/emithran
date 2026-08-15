import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pdfBuffer, fileName, balloonCoordinates } = body;

    // If balloon coordinates are provided, extract dimensions at those exact locations
    if (balloonCoordinates && Array.isArray(balloonCoordinates)) {
      
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
      
    } catch (parseError) {
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
    
  } catch (error) {
    throw new Error('Failed to parse PDF for coordinate extraction');
  }

  const inspectionRows = [];
  
  // Process each balloon coordinate
  for (let i = 0; i < balloonCoordinates.length; i++) {
    const balloon = balloonCoordinates[i];
    
    // Try multiple coordinate mapping approaches for better accuracy
    let dimensionText = '';
    
    // Method 1: Direct coordinates with small radius
    dimensionText = findTextNearCoordinates(pdfData, balloon.x, balloon.y, 15);
    
    // Method 2: If no text found, try scaled coordinates
    if (!dimensionText) {
      const scaledX = balloon.x * 0.75; // Try 75% scaling
      const scaledY = balloon.y * 0.75;
      dimensionText = findTextNearCoordinates(pdfData, scaledX, scaledY, 20);
    }
    
    // Method 3: If still no text found, try larger radius with original coordinates
    if (!dimensionText) {
      dimensionText = findTextNearCoordinates(pdfData, balloon.x, balloon.y, 40);
    }
    
    if (dimensionText) {
      // Extract the actual dimension from the found text
      const dimension = extractDimensionFromText(dimensionText, balloon.number, balloonCoordinates.length);
      
      if (dimension) {
        inspectionRows.push(dimension);
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

interface ExtractedDimension {
  value: string;
  specification: string;
  method: string;
  type: string;
  plusTol?: string;
  minusTol?: string;
  additionalInfo?: string;
}

function extractDimensionFromText(text: string, balloonNumber: number, totalBalloons: number = 5): any | null {

  // Enhanced dimension patterns based on engineering drawing standards
  // Sorted by priority: main dimensions first, then tolerances
  const patterns = [
    // Diameter with complex tolerance: "∅20 +0.10/-0.05", "∅21.5 +0.05/-0.10"
    {
      regex: /[⌀∅øØΦφ]\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*\+\s*(\d+(?:\.\d+)?)\s*\/?\s*[-−]\s*(\d+(?:\.\d+)?)/,
      priority: 100,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        const plus = match[2];
        const minus = match[3];
        if (!value || !plus || !minus) return null;
        return {
          value,
          plusTol: `+${plus}`,
          minusTol: `-${minus}`,
          specification: 'Diameter',
          method: 'Micrometer',
          type: 'diameter_complex'
        };
      }
    },
    // Linear complex toleranced dimensions: "20 +0.10 -0.05" (spaces between + and -)
    {
      regex: /(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*\+\s*(\d+(?:\.\d+)?)\s*[-−]\s*(\d+(?:\.\d+)?)/,
      priority: 95,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        const plus = match[2];
        const minus = match[3];
        if (!value || !plus || !minus) return null;
        return {
          value,
          plusTol: `+${plus}`,
          minusTol: `-${minus}`,
          specification: 'Linear Dimension',
          method: 'Caliper',
          type: 'linear_complex'
        };
      }
    },
    // Diameter with tolerance: "∅18 ±0.1", "∅15 ±0.05"
    {
      regex: /[⌀∅øØΦφ]\s*(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*[±]\s*(\d+(?:\.\d+)?)/,
      priority: 90,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        const tol = match[2];
        if (!value || !tol) return null;
        return {
          value,
          plusTol: `+${tol}`,
          minusTol: `-${tol}`,
          specification: 'Diameter',
          method: 'Micrometer',
          type: 'diameter_toleranced'
        };
      }
    },
    // Basic diameter: "∅35"
    {
      regex: /[⌀∅øØΦφ]\s*(\d+(?:\.\d+)?)/,
      priority: 85,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        if (!value) return null;
        return {
          value,
          specification: 'Diameter',
          method: 'Micrometer',
          type: 'diameter'
        };
      }
    },
    // Chamfer/surface profile: "0.30 X 45°"
    {
      regex: /(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[°◦]/,
      priority: 80,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        const angle = match[2];
        if (!value || !angle) return null;
        return {
          value,
          specification: 'Chamfer',
          method: 'Protractor/CMM',
          plusTol: '+0.1',
          minusTol: '-0.1',
          type: 'chamfer',
          additionalInfo: `${angle}°`
        };
      }
    },
    // Linear dimension with tolerance: "1.5 ±0.05", "18 ±0.1"
    {
      regex: /(\d+(?:\.\d+)?)\s*(?:mm|cm|in|")?\s*[±]\s*(\d+(?:\.\d+)?)/,
      priority: 75,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        const tol = match[2];
        if (!value || !tol) return null;
        return {
          value,
          plusTol: `+${tol}`,
          minusTol: `-${tol}`,
          specification: 'Linear Dimension',
          method: 'Caliper',
          type: 'linear_toleranced'
        };
      }
    },
    // Radius: "R5.2"
    {
      regex: /R\s*(\d+(?:\.\d+)?)/,
      priority: 65,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        if (!value) return null;
        return {
          value,
          specification: 'Radius',
          method: 'Radius Gauge',
          type: 'radius'
        };
      }
    },
    // Angular only: "45°"
    {
      regex: /(\d+(?:\.\d+)?)\s*[°◦]/,
      priority: 60,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        if (!value) return null;
        return {
          value,
          specification: 'Angular Dimension',
          method: 'Protractor/CMM',
          plusTol: '+0.5',
          minusTol: '-0.5',
          type: 'angular'
        };
      }
    },
    // Surface finish: "Ra 3.2"
    {
      regex: /(?:Ra|Rz)\s*(\d+(?:\.\d+)?)/,
      priority: 55,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        if (!value) return null;
        return {
          value,
          specification: 'Surface Finish (Ra)',
          method: 'Surface Roughness Tester',
          plusTol: '+0',
          minusTol: '-0',
          type: 'surface'
        };
      }
    },
    // Multi-digit or significant dimensions (prioritize over small tolerance values)
    {
      regex: /(\d{2,}(?:\.\d+)?|\d+\.\d+)/,
      priority: 50,
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        if (!value) return null;
        const val = parseFloat(value);
        // Only accept if it's a reasonable dimension (not a small tolerance like 0.05)
        if (val >= 1.0) {
          return {
            value,
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
      extract: (match: RegExpMatchArray): ExtractedDimension | null => {
        const value = match[1];
        if (!value) return null;
        return {
          value,
          specification: 'GD&T Tolerance',
          method: 'CMM',
          type: 'tolerance'
        };
      }
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

  return null;
}

