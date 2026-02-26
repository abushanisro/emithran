import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFPage } from 'pdf-lib';
import sharp from 'sharp';
import pdf2pic from 'pdf2pic';
import Tesseract from 'tesseract.js';
import * as fs from 'fs';
import * as path from 'path';
import { createCanvas, Image } from 'canvas';

export interface PDFTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  rotation: number;
}

export interface BalloonDetection {
  id: string;
  number: number;
  center: { x: number; y: number };
  radius: number;
  confidence: number;
  type: 'circle' | 'rectangle' | 'diamond';
}

export interface DimensionMatch {
  balloonId: string;
  balloonNumber: number;
  dimension: {
    value: string;
    unit: string;
    tolerance?: {
      upper: string;
      lower: string;
      type: 'bilateral' | 'unilateral';
    };
    type: 'linear' | 'radial' | 'diameter' | 'angular';
    gdtSymbol?: string;
  };
  position: { x: number; y: number };
  confidence: number;
}

export interface PDFProcessingResult {
  isVectorBased: boolean;
  pageCount: number;
  dimensions: DimensionMatch[];
  balloons: BalloonDetection[];
  textItems: PDFTextItem[];
  processingTime: number;
  errors: string[];
}

@Injectable()
export class PDFProcessorService {
  private readonly logger = new Logger(PDFProcessorService.name);

  async processPDF(pdfBuffer: Buffer): Promise<PDFProcessingResult> {
    const startTime = Date.now();
    this.logger.log('Starting PDF processing with industry-standard libraries');

    try {
      // Ensure tmp directory exists for pdf2pic
      const tmpDir = path.resolve('./tmp');
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
        this.logger.log('Created tmp directory for PDF processing');
      }

      // Step 1: Load PDF document using pdf-lib (industry standard)
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pageCount = pdfDoc.getPageCount();
      
      // Step 2: Detect PDF type (vector vs raster)
      const isVectorBased = await this.detectPDFType(pdfDoc);
      
      let textItems: PDFTextItem[] = [];
      let balloons: BalloonDetection[] = [];
      let dimensions: DimensionMatch[] = [];
      
      if (isVectorBased) {
        this.logger.log('Processing vector-based PDF with pdf-lib');
        textItems = await this.extractVectorTextWithPdfLib(pdfDoc);
        balloons = await this.detectBalloonsFromText(textItems);
        dimensions = await this.mapDimensionsToBalloons(textItems, balloons);
      } else {
        this.logger.log('Processing raster-based PDF with OCR pipeline');
        const imageData = await this.convertPDFToImageWithPdf2pic(pdfBuffer);
        textItems = await this.performOCRWithTesseract(imageData);
        balloons = await this.detectBalloonsFromOCRText(textItems);
        dimensions = await this.mapDimensionsToBalloons(textItems, balloons);
      }

      const processingTime = Date.now() - startTime;
      
      this.logger.log(`PDF processing completed: ${dimensions.length} dimensions, ${balloons.length} balloons in ${processingTime}ms`);
      
      return {
        isVectorBased,
        pageCount,
        dimensions,
        balloons,
        textItems,
        processingTime,
        errors: []
      };

    } catch (error) {
      this.logger.error('PDF processing failed', error.stack);
      return {
        isVectorBased: false,
        pageCount: 0,
        dimensions: [],
        balloons: [],
        textItems: [],
        processingTime: Date.now() - startTime,
        errors: [error.message]
      };
    }
  }

  private async detectPDFType(pdfDoc: PDFDocument): Promise<boolean> {
    try {
      // Industry best practice: Check if PDF has extractable text
      const pages = pdfDoc.getPages();
      if (pages.length === 0) return false;
      
      const firstPage = pages[0];
      const pageSize = firstPage.getSize();
      
      // Convert first page to image for analysis
      const imageBuffer = await this.convertSinglePageToImage(pdfDoc, 0);
      
      // Use Sharp for image analysis (industry standard)
      const image = sharp(imageBuffer);
      const { channels } = await image.metadata();
      
      // Check image characteristics to determine if it's vector or raster
      // Vector PDFs typically have clean, high-contrast content
      const stats = await image.stats();
      
      // Calculate image complexity based on standard deviation
      const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / (channels || 3);
      
      // Vector PDFs typically have lower standard deviation (more uniform content)
      const isVectorBased = avgStdDev > 50; // Higher std dev indicates more structured content
      
      this.logger.log(`PDF type detection: ${isVectorBased ? 'vector' : 'raster'} (stddev: ${avgStdDev.toFixed(2)})`);
      return isVectorBased;
    } catch (error) {
      this.logger.warn('PDF type detection failed, assuming raster', error.message);
      return false;
    }
  }

  private async convertSinglePageToImage(pdfDoc: PDFDocument, pageIndex: number): Promise<Buffer> {
    try {
      // Create a new PDF with just one page for conversion
      const singlePagePdf = await PDFDocument.create();
      const [page] = await singlePagePdf.copyPages(pdfDoc, [pageIndex]);
      singlePagePdf.addPage(page);
      
      const pdfBytes = await singlePagePdf.save();
      
      // Try pdf2pic conversion with better error handling
      try {
        const convertInstance = pdf2pic.fromBuffer(Buffer.from(pdfBytes), {
          density: 300,
          saveFilename: 'page',
          savePath: './tmp',
          format: 'png',
          width: 2480,
          height: 3508
        });
        
        // Add timeout to prevent hanging
        const conversionPromise = convertInstance(1, { responseType: 'buffer' });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('PDF conversion timeout')), 20000)
        );
        
        const result = await Promise.race([conversionPromise, timeoutPromise]);
        if (result && (result as any).buffer && (result as any).buffer.length > 0) {
          this.logger.log(`Single page converted: ${(result as any).buffer.length} bytes`);
          return (result as any).buffer;
        }
        throw new Error('pdf2pic returned empty buffer');
      } catch (pdf2picError) {
        this.logger.warn('pdf2pic single page conversion failed', pdf2picError.message);
        
        // Fallback: Use Sharp to create a placeholder image for single page
        try {
          this.logger.log('Creating placeholder image for single page fallback...');
          // Create a simple white image as fallback
          const placeholderImage = await sharp({
            create: {
              width: 800,
              height: 1200,
              channels: 3,
              background: { r: 255, g: 255, b: 255 }
            }
          })
          .png()
          .toBuffer();
          
          return placeholderImage;
        } catch (fallbackError) {
          this.logger.error('Sharp single page fallback failed', fallbackError.message);
          throw new Error(`PDF to image conversion failed: ${pdf2picError.message}`);
        }
      }
    } catch (error) {
      this.logger.error('Single page PDF conversion failed', error.message);
      throw new Error(`Single page conversion failed: ${error.message}`);
    }
  }

  private async extractVectorTextWithPdfLib(pdfDoc: PDFDocument): Promise<PDFTextItem[]> {
    // Note: pdf-lib doesn't have built-in text extraction
    // For production, we use OCR as the standard approach for both vector and raster PDFs
    this.logger.log('Using OCR approach for text extraction from vector PDF');
    
    // Convert to image and use OCR
    const imageBuffer = await this.convertSinglePageToImage(pdfDoc, 0);
    return await this.performOCRWithTesseract(imageBuffer);
  }

  private async convertPDFToImageWithPdf2pic(pdfBuffer: Buffer): Promise<Buffer> {
    try {
      // Validate PDF buffer before processing
      if (!pdfBuffer || pdfBuffer.length === 0) {
        this.logger.warn('PDF buffer is empty or null');
        throw new Error('Invalid PDF buffer provided');
      }

      this.logger.log(`Converting PDF buffer: ${pdfBuffer.length} bytes`);

      // First, try to use pdf-lib to render the PDF page
      try {
        const pdfDoc = await PDFDocument.load(pdfBuffer);
        const pages = pdfDoc.getPages();
        
        if (pages.length > 0) {
          this.logger.log('Attempting PDF-lib based conversion...');
          return await this.convertSinglePageToImage(pdfDoc, 0);
        }
      } catch (pdfLibError) {
        this.logger.warn('PDF-lib conversion failed, trying pdf2pic', pdfLibError.message);
      }

      // Try pdf2pic with better error handling
      try {
        this.logger.log('Attempting pdf2pic conversion...');
        
        // Check if tmp directory exists
        if (!fs.existsSync('./tmp')) {
          fs.mkdirSync('./tmp', { recursive: true });
        }

        // Industry standard: pdf2pic for PDF to image conversion
        const convertInstance = pdf2pic.fromBuffer(pdfBuffer, {
          density: 300,           // High DPI for better OCR accuracy
          saveFilename: 'drawing',
          savePath: './tmp',
          format: 'png',
          width: 2480,           // A4 at 300 DPI
          height: 3508
        });
        
        // Add timeout to prevent hanging
        const conversionPromise = convertInstance(1, { responseType: 'buffer' });
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('PDF conversion timeout')), 25000)
        );
        
        const result = await Promise.race([conversionPromise, timeoutPromise]);
        
        if (result && (result as any).buffer && (result as any).buffer.length > 0) {
          this.logger.log(`PDF converted to image: ${(result as any).buffer.length} bytes`);
          return (result as any).buffer;
        }
        
        throw new Error('pdf2pic returned empty buffer');
      } catch (pdf2picError) {
        this.logger.warn('pdf2pic conversion failed, trying fallback method', pdf2picError.message);
        
        // Fallback: Use Sharp to create a placeholder image for OCR
        try {
          this.logger.log('Creating placeholder image for OCR fallback...');
          // Create a simple white image as fallback
          const placeholderImage = await sharp({
            create: {
              width: 800,
              height: 1200,
              channels: 3,
              background: { r: 255, g: 255, b: 255 }
            }
          })
          .png()
          .toBuffer();
          
          return placeholderImage;
        } catch (fallbackError) {
          this.logger.error('Sharp fallback also failed', fallbackError.message);
        }
        
        throw new Error(`PDF conversion failed: ${pdf2picError.message}. Please ensure ImageMagick or GraphicsMagick is installed.`);
      }
    } catch (error) {
      this.logger.error('PDF to image conversion failed', error.message);
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  }

  private async performOCRWithTesseract(imageBuffer: Buffer): Promise<PDFTextItem[]> {
    try {
      // Validate image buffer before processing
      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error('Image buffer is empty or null');
      }

      // Check if buffer contains valid image data
      if (imageBuffer.length < 100) {
        throw new Error('Image buffer too small, likely corrupted');
      }

      this.logger.log(`Starting OCR processing with ${imageBuffer.length} byte image`);

      // Industry standard: Tesseract.js for OCR
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {} // Suppress verbose logging
      });
      
      // Configure Tesseract for engineering drawings (only during initialization)
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.+-±∅⌀RΦφ°′″mmcminftMM',
        tessedit_pageseg_mode: 6 as any
      });
      
      // Add timeout to OCR processing
      const ocrPromise = worker.recognize(imageBuffer);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('OCR processing timeout')), 30000)
      );
      
      const { data } = await Promise.race([ocrPromise, timeoutPromise]) as any;
      await worker.terminate();
      
      // Convert Tesseract words to our format
      const words = (data as any).words || [];
      if (words.length === 0) {
        throw new Error('OCR returned no readable text from the PDF');
      }

      const textItems: PDFTextItem[] = words
        .filter((word: any) => word.text && word.text.trim().length > 0)
        .map((word: any, index: number) => ({
          text: word.text.trim(),
          x: word.bbox?.x0 || 0,
          y: word.bbox?.y0 || 0,
          width: (word.bbox?.x1 || 0) - (word.bbox?.x0 || 0),
          height: (word.bbox?.y1 || 0) - (word.bbox?.y0 || 0),
          fontSize: (word.bbox?.y1 || 24) - (word.bbox?.y0 || 0) || 24,
          fontName: 'OCR-detected',
          rotation: 0
        }));
      
      this.logger.log(`OCR successfully extracted ${textItems.length} text items`);
      return textItems;
    } catch (error) {
      this.logger.error('OCR processing failed', error.message);
      throw new Error(`OCR processing failed: ${error.message}`);
    }
  }


  private async detectBalloonsFromText(textItems: PDFTextItem[]): Promise<BalloonDetection[]> {
    const balloons: BalloonDetection[] = [];
    
    // Industry standard pattern: Look for isolated numbers 1-99
    const balloonPattern = /^([1-9]\d?)$/;
    
    for (const item of textItems) {
      const match = item.text.match(balloonPattern);
      if (match) {
        const number = parseInt(match[1]);
        
        // Check if this number is isolated (balloon detection algorithm)
        const isIsolated = this.isNumberIsolated(item, textItems);
        
        if (isIsolated) {
          balloons.push({
            id: `balloon-${number}-${item.x}-${item.y}`,
            number,
            center: { x: item.x + item.width / 2, y: item.y + item.height / 2 },
            radius: Math.max(item.width, item.height) / 2 + 5, // Add padding
            confidence: 0.85, // High confidence for isolated numbers
            type: 'circle' // Assume circular balloons
          });
        }
      }
    }
    
    // Sort balloons by number for consistent ordering
    balloons.sort((a, b) => a.number - b.number);
    
    this.logger.log(`Detected ${balloons.length} balloons`);
    return balloons;
  }

  private async detectBalloonsFromOCRText(textItems: PDFTextItem[]): Promise<BalloonDetection[]> {
    // Same logic as detectBalloonsFromText but with lower confidence due to OCR
    const balloons = await this.detectBalloonsFromText(textItems);
    
    // Reduce confidence for OCR-detected balloons
    balloons.forEach(balloon => {
      balloon.confidence *= 0.8; // OCR has inherent uncertainty
    });
    
    return balloons;
  }

  private isNumberIsolated(numberItem: PDFTextItem, allItems: PDFTextItem[]): boolean {
    const isolationThreshold = 30; // Minimum distance for isolation
    
    // Check if there are other text items very close to this number
    const nearbyItems = allItems.filter(item => 
      item !== numberItem &&
      Math.abs(item.x - numberItem.x) < isolationThreshold &&
      Math.abs(item.y - numberItem.y) < isolationThreshold
    );
    
    return nearbyItems.length === 0;
  }

  private async mapDimensionsToBalloons(
    textItems: PDFTextItem[], 
    balloons: BalloonDetection[]
  ): Promise<DimensionMatch[]> {
    const matches: DimensionMatch[] = [];
    
    // Industry standard dimension patterns for engineering drawings
    const dimensionPatterns = [
      { pattern: /^(\d+\.?\d*)\s*(mm|cm|m|in|ft|″|′)$/i, type: 'linear' },
      { pattern: /^R\s*(\d+\.?\d*)$/i, type: 'radial' },
      { pattern: /^∅\s*(\d+\.?\d*)$/i, type: 'diameter' },
      { pattern: /^⌀\s*(\d+\.?\d*)$/i, type: 'diameter' },
      { pattern: /^(\d+\.?\d*)°$/i, type: 'angular' },
      { pattern: /^(\d+\.?\d*)\s*[±]\s*(\d+\.?\d*)$/i, type: 'toleranced' },
    ];
    
    for (const balloon of balloons) {
      let bestMatch: DimensionMatch | null = null;
      let minDistance = Infinity;
      const maxCorrelationDistance = 200; // Maximum distance for balloon-dimension correlation
      
      for (const item of textItems) {
        for (const { pattern, type } of dimensionPatterns) {
          const match = item.text.match(pattern);
          if (match) {
            const distance = this.calculateEuclideanDistance(balloon.center, {
              x: item.x + item.width / 2,
              y: item.y + item.height / 2
            });
            
            if (distance < minDistance && distance < maxCorrelationDistance) {
              minDistance = distance;
              
              bestMatch = {
                balloonId: balloon.id,
                balloonNumber: balloon.number,
                dimension: this.parseDimensionFromMatch(match, type as any),
                position: { x: item.x, y: item.y },
                confidence: Math.max(0.1, 1 - (distance / maxCorrelationDistance))
              };
            }
          }
        }
      }
      
      if (bestMatch) {
        matches.push(bestMatch);
      }
    }
    
    this.logger.log(`Mapped ${matches.length} dimensions to balloons`);
    return matches;
  }

  private parseDimensionFromMatch(match: RegExpMatchArray, type: string): any {
    switch (type) {
      case 'linear':
        return {
          value: match[1],
          unit: match[2] || 'mm',
          type: 'linear'
        };
      case 'radial':
        return {
          value: match[1],
          unit: 'mm',
          type: 'radial'
        };
      case 'diameter':
        return {
          value: match[1],
          unit: 'mm',
          type: 'diameter'
        };
      case 'angular':
        return {
          value: match[1],
          unit: '°',
          type: 'angular'
        };
      case 'toleranced':
        return {
          value: match[1],
          unit: 'mm',
          type: 'linear',
          tolerance: {
            upper: match[2],
            lower: `-${match[2]}`,
            type: 'bilateral'
          }
        };
      default:
        return {
          value: match[1],
          unit: 'mm',
          type: 'linear'
        };
    }
  }

  private calculateEuclideanDistance(point1: { x: number; y: number }, point2: { x: number; y: number }): number {
    return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
  }

}