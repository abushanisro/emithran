import { Request, Response } from 'express';
import { Pool } from 'pg';
import { IsString, IsNumber, IsOptional, IsArray, IsUUID, IsEnum, IsInt, Min, Max, ValidateNested, ArrayMinSize, ArrayMaxSize, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

// Validation DTOs using class-validator (NestJS standard)
class BalloonAnnotationDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsNumber()
  number: number;

  @IsNumber()
  x: number;

  @IsNumber()
  y: number;
}

class MeasurementDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsNumber()
  slNo: number;

  @IsString()
  @IsNotEmpty()
  specification: string;

  @IsNumber()
  nominal: number;

  @IsNumber()
  plusTolerance: number;

  @IsNumber()
  minusTolerance: number;

  @IsString()
  @IsNotEmpty()
  method: string;

  @IsArray()
  @IsNumber({}, { each: true })
  sampleValues: number[];

  @IsOptional()
  @IsString()
  remarks?: string;
}

class BalloonDrawingDto {
  @IsString()
  @IsNotEmpty()
  partName: string;

  @IsString()
  @IsNotEmpty()
  material: string;

  @IsOptional()
  @IsString()
  surfaceTreatment?: string;

  @IsString()
  @IsNotEmpty()
  drawingTitle: string;

  @IsString()
  @IsNotEmpty()
  drawingSize: string = 'A4';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalloonAnnotationDto)
  balloonAnnotations: BalloonAnnotationDto[];
}

class FinalInspectionReportDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsOptional()
  @IsString()
  revisionNumber?: string;

  @IsString()
  @IsNotEmpty()
  inspectionDate: string;

  @IsString()
  @IsNotEmpty()
  rawMaterial: string;

  @IsString()
  @IsNotEmpty()
  inspectionBy: string;

  @IsOptional()
  @IsString()
  approvedBy?: string;

  @IsOptional()
  @IsString()
  generalRemarks?: string;

  @IsEnum(['draft', 'release', 'rejected'])
  status: 'draft' | 'release' | 'rejected' = 'draft';
}

class InspectionTableDto {
  @IsInt()
  @Min(1)
  @Max(5)
  samples: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements: MeasurementDto[];
}

class DetailedInspectionReportDto {
  @IsUUID()
  inspectionId: string;

  @ValidateNested()
  @Type(() => BalloonDrawingDto)
  balloonDrawing: BalloonDrawingDto;

  @ValidateNested()
  @Type(() => FinalInspectionReportDto)
  finalInspectionReport: FinalInspectionReportDto;

  @ValidateNested()
  @Type(() => InspectionTableDto)
  inspectionTable: InspectionTableDto;
}

interface DatabasePool {
  pool: Pool;
}

/**
 * Save or update detailed inspection report
 */
export async function saveDetailedInspectionReport(req: Request & DatabasePool, res: Response) {
  const { pool } = req;
  
  try {
    // Manual validation for now - in a proper NestJS controller this would be handled by pipes
    const { inspectionId, balloonDrawing, finalInspectionReport, inspectionTable } = req.body;
    
    // Basic validation
    if (!inspectionId || typeof inspectionId !== 'string') {
      throw new Error('Invalid inspectionId');
    }
    if (!balloonDrawing || !finalInspectionReport || !inspectionTable) {
      throw new Error('Missing required fields');
    }

    // Check if inspection exists
    const inspectionCheck = await pool.query(
      'SELECT id FROM quality_inspections WHERE id = $1',
      [inspectionId]
    );

    if (inspectionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Inspection not found',
          code: 'INSPECTION_NOT_FOUND'
        }
      });
    }

    // Upsert detailed inspection report
    const query = `
      INSERT INTO detailed_inspection_reports (
        inspection_id,
        part_name,
        material,
        surface_treatment,
        drawing_title,
        drawing_size,
        balloon_annotations,
        company_name,
        revision_number,
        inspection_date,
        raw_material,
        inspection_by,
        approved_by,
        general_remarks,
        status,
        samples,
        measurements
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      ON CONFLICT (inspection_id) 
      DO UPDATE SET
        part_name = EXCLUDED.part_name,
        material = EXCLUDED.material,
        surface_treatment = EXCLUDED.surface_treatment,
        drawing_title = EXCLUDED.drawing_title,
        drawing_size = EXCLUDED.drawing_size,
        balloon_annotations = EXCLUDED.balloon_annotations,
        company_name = EXCLUDED.company_name,
        revision_number = EXCLUDED.revision_number,
        inspection_date = EXCLUDED.inspection_date,
        raw_material = EXCLUDED.raw_material,
        inspection_by = EXCLUDED.inspection_by,
        approved_by = EXCLUDED.approved_by,
        general_remarks = EXCLUDED.general_remarks,
        status = EXCLUDED.status,
        samples = EXCLUDED.samples,
        measurements = EXCLUDED.measurements,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      inspectionId,
      balloonDrawing.partName,
      balloonDrawing.material,
      balloonDrawing.surfaceTreatment || null,
      balloonDrawing.drawingTitle,
      balloonDrawing.drawingSize,
      JSON.stringify(balloonDrawing.balloonAnnotations),
      finalInspectionReport.companyName,
      finalInspectionReport.revisionNumber || null,
      finalInspectionReport.inspectionDate,
      finalInspectionReport.rawMaterial,
      finalInspectionReport.inspectionBy,
      finalInspectionReport.approvedBy || null,
      finalInspectionReport.generalRemarks || null,
      finalInspectionReport.status,
      inspectionTable.samples,
      JSON.stringify(inspectionTable.measurements),
    ];

    const result = await pool.query(query, values);
    const savedReport = result.rows[0];

    // Transform database result back to API format
    const responseData = {
      inspectionId: savedReport.inspection_id,
      balloonDrawing: {
        partName: savedReport.part_name,
        material: savedReport.material,
        surfaceTreatment: savedReport.surface_treatment,
        drawingTitle: savedReport.drawing_title,
        drawingSize: savedReport.drawing_size,
        balloonAnnotations: savedReport.balloon_annotations,
      },
      finalInspectionReport: {
        companyName: savedReport.company_name,
        revisionNumber: savedReport.revision_number,
        inspectionDate: savedReport.inspection_date,
        rawMaterial: savedReport.raw_material,
        inspectionBy: savedReport.inspection_by,
        approvedBy: savedReport.approved_by,
        generalRemarks: savedReport.general_remarks,
        status: savedReport.status,
      },
      inspectionTable: {
        samples: savedReport.samples,
        measurements: savedReport.measurements,
      },
      createdAt: savedReport.created_at,
      updatedAt: savedReport.updated_at,
    };

    res.status(200).json({
      success: true,
      data: responseData,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown',
      },
    });

  } catch (error) {
    console.error('Error saving detailed inspection report:', error);

    if (error.message?.includes('Invalid') || error.message?.includes('Missing')) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: error.message,
        },
      });
    }

    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to save detailed inspection report',
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
  }
}

/**
 * Get detailed inspection report by inspection ID
 */
export async function getDetailedInspectionReport(req: Request & DatabasePool, res: Response) {
  const { pool } = req;
  const { inspectionId } = req.params;

  try {
    // Validate inspection ID format
    if (!inspectionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(inspectionId)) {
      return res.status(400).json({
        success: false,
        error: {
          message: 'Invalid inspection ID format',
          code: 'INVALID_INSPECTION_ID',
        },
      });
    }

    const query = `
      SELECT * FROM detailed_inspection_reports 
      WHERE inspection_id = $1
    `;

    const result = await pool.query(query, [inspectionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Detailed inspection report not found',
          code: 'REPORT_NOT_FOUND',
        },
      });
    }

    const report = result.rows[0];

    // Transform database result to API format
    const responseData = {
      inspectionId: report.inspection_id,
      balloonDrawing: {
        partName: report.part_name,
        material: report.material,
        surfaceTreatment: report.surface_treatment,
        drawingTitle: report.drawing_title,
        drawingSize: report.drawing_size,
        balloonAnnotations: report.balloon_annotations,
      },
      finalInspectionReport: {
        companyName: report.company_name,
        revisionNumber: report.revision_number,
        inspectionDate: report.inspection_date,
        rawMaterial: report.raw_material,
        inspectionBy: report.inspection_by,
        approvedBy: report.approved_by,
        generalRemarks: report.general_remarks,
        status: report.status,
      },
      inspectionTable: {
        samples: report.samples,
        measurements: report.measurements,
      },
      createdAt: report.created_at,
      updatedAt: report.updated_at,
    };

    res.status(200).json({
      success: true,
      data: responseData,
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown',
      },
    });

  } catch (error) {
    console.error('Error fetching detailed inspection report:', error);

    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to fetch detailed inspection report',
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
  }
}

/**
 * Delete detailed inspection report
 */
export async function deleteDetailedInspectionReport(req: Request & DatabasePool, res: Response) {
  const { pool } = req;
  const { inspectionId } = req.params;

  try {
    const query = `
      DELETE FROM detailed_inspection_reports 
      WHERE inspection_id = $1
      RETURNING id
    `;

    const result = await pool.query(query, [inspectionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          message: 'Detailed inspection report not found',
          code: 'REPORT_NOT_FOUND',
        },
      });
    }

    res.status(200).json({
      success: true,
      data: { deleted: true },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: req.headers['x-request-id'] || 'unknown',
      },
    });

  } catch (error) {
    console.error('Error deleting detailed inspection report:', error);

    res.status(500).json({
      success: false,
      error: {
        message: 'Failed to delete detailed inspection report',
        code: 'INTERNAL_SERVER_ERROR',
      },
    });
  }
}