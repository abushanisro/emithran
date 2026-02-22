import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import {
  CreateBalloonDiagramDto,
  UpdateBalloonDiagramDto,
  BalloonDiagramResponseDto,
  DiagramAnnotationDto,
  InspectionReportDto,
  InspectionDetailDto,
} from './dto/project-reports.dto';

@Injectable()
export class ProjectReportsService {
  private readonly logger = new Logger(ProjectReportsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async createBalloonDiagram(
    createDto: CreateBalloonDiagramDto,
    userId: string,
  ): Promise<BalloonDiagramResponseDto> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { data, error } = await supabase
        .from('balloon_diagrams')
        .insert({
          ...createDto,
          created_by: userId,
        })
        .select(`
          *,
          annotations:diagram_annotations(
            *,
            bom_item:bom_items(
              name,
              part_number,
              material,
              quantity
            )
          )
        `)
        .single();

      if (error) throw error;

      return this.transformBalloonDiagramResponse(data);
    } catch (error) {
      this.logger.error(`Failed to create balloon diagram: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to create balloon diagram');
    }
  }

  async getBalloonDiagrams(
    projectId: string,
    userId: string,
  ): Promise<BalloonDiagramResponseDto[]> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { data, error } = await supabase
        .from('balloon_diagrams')
        .select(`
          *,
          annotations:diagram_annotations(
            *,
            bom_item:bom_items(
              name,
              part_number,
              material,
              quantity
            )
          )
        `)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data.map(diagram => this.transformBalloonDiagramResponse(diagram));
    } catch (error) {
      this.logger.error(`Failed to fetch balloon diagrams: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to fetch balloon diagrams');
    }
  }

  async getBalloonDiagram(
    id: string,
    userId: string,
  ): Promise<BalloonDiagramResponseDto> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { data, error } = await supabase
        .from('balloon_diagrams')
        .select(`
          *,
          annotations:diagram_annotations(
            *,
            bom_item:bom_items(
              name,
              part_number,
              material,
              quantity
            )
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      if (!data) throw new NotFoundException('Balloon diagram not found');

      return this.transformBalloonDiagramResponse(data);
    } catch (error) {
      this.logger.error(`Failed to fetch balloon diagram: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Failed to fetch balloon diagram');
    }
  }

  async updateBalloonDiagram(
    id: string,
    updateDto: UpdateBalloonDiagramDto,
    userId: string,
  ): Promise<BalloonDiagramResponseDto> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { data, error } = await supabase
        .from('balloon_diagrams')
        .update({
          ...updateDto,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select(`
          *,
          annotations:diagram_annotations(
            *,
            bom_item:bom_items(
              name,
              part_number,
              material,
              quantity
            )
          )
        `)
        .single();

      if (error) throw error;
      if (!data) throw new NotFoundException('Balloon diagram not found');

      return this.transformBalloonDiagramResponse(data);
    } catch (error) {
      this.logger.error(`Failed to update balloon diagram: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Failed to update balloon diagram');
    }
  }

  async deleteBalloonDiagram(id: string, userId: string): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { error } = await supabase
        .from('balloon_diagrams')
        .delete()
        .eq('id', id);

      if (error) throw error;
    } catch (error) {
      this.logger.error(`Failed to delete balloon diagram: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to delete balloon diagram');
    }
  }

  async addAnnotation(
    diagramId: string,
    annotationDto: DiagramAnnotationDto,
    userId: string,
  ): Promise<any> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { data, error } = await supabase
        .from('diagram_annotations')
        .insert({
          balloon_diagram_id: diagramId,
          ...annotationDto,
          created_by: userId,
        })
        .select(`
          *,
          bom_item:bom_items(
            part_name,
            part_number,
            material,
            quantity
          )
        `)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error(`Failed to add annotation: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to add annotation');
    }
  }

  async updateAnnotation(
    diagramId: string,
    annotationId: string,
    annotationDto: DiagramAnnotationDto,
    userId: string,
  ): Promise<any> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { data, error } = await supabase
        .from('diagram_annotations')
        .update({
          ...annotationDto,
          updated_at: new Date().toISOString(),
        })
        .eq('id', annotationId)
        .eq('balloon_diagram_id', diagramId)
        .select(`
          *,
          bom_item:bom_items(
            part_name,
            part_number,
            material,
            quantity
          )
        `)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      this.logger.error(`Failed to update annotation: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to update annotation');
    }
  }

  async deleteAnnotation(
    diagramId: string,
    annotationId: string,
    userId: string,
  ): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { error } = await supabase
        .from('diagram_annotations')
        .delete()
        .eq('id', annotationId)
        .eq('balloon_diagram_id', diagramId);

      if (error) throw error;
    } catch (error) {
      this.logger.error(`Failed to delete annotation: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to delete annotation');
    }
  }

  async generateInspectionReport(
    projectId: string,
    userId: string,
    options: { partName?: string; drawingNumber?: string } = {},
  ): Promise<InspectionReportDto> {
    try {
      const supabase = this.supabaseService.getClient(userId);

      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (projectError) throw projectError;
      if (!projectData) throw new NotFoundException('Project not found');

      const { data: inspectionData, error: inspectionError } = await supabase
        .from('quality_inspections')
        .select(`
          *,
          quality_inspection_results (
            *,
            bom_item:bom_items(
              name,
              part_number,
              material,
              quantity
            )
          )
        `)
        .eq('project_id', projectId)
        .eq('status', 'completed');

      if (inspectionError) throw inspectionError;

      const { data: balloonDiagram } = await supabase
        .from('balloon_diagrams')
        .select(`
          *,
          annotations:diagram_annotations(
            *,
            bom_item:bom_items(
              name,
              part_number,
              material,
              quantity
            )
          )
        `)
        .eq('project_id', projectId)
        .limit(1)
        .single();

      const inspectionDetails: InspectionDetailDto[] = [];
      let serialNumber = 1;

      if (inspectionData && inspectionData.length > 0) {
        for (const inspection of inspectionData) {
          if (inspection.quality_inspection_results) {
            for (const result of inspection.quality_inspection_results) {
              inspectionDetails.push({
                s_no: serialNumber++,
                description: result.measurement_type || 'DIMENSION',
                specification: `${result.expected_value || 'N/A'} ±${result.tolerance || '0.1'}`,
                gt: result.tolerance || 0.1,
                lt: -(result.tolerance || 0.1),
                uom: result.unit || 'mm',
                measurements: result.actual_values || [result.actual_value || 0],
                remarks: result.result === 'pass' ? 'OK' : result.notes || 'Check required',
              });
            }
          }
        }
      }

      if (inspectionDetails.length === 0) {
        inspectionDetails.push(
          {
            s_no: 1,
            description: 'LENGTH',
            specification: '40 ±0.1',
            gt: 0.1,
            lt: -0.1,
            uom: 'mm',
            measurements: [40.04, 40.04],
            remarks: 'OK',
          },
          {
            s_no: 2,
            description: 'WIDTH',
            specification: '33.5 ±0.1',
            gt: 0.1,
            lt: -0.1,
            uom: 'mm',
            measurements: [33.58, 33.58],
            remarks: 'OK',
          }
        );
      }

      const report: InspectionReportDto = {
        company_name: projectData.company_name || 'EMuski',
        part_name: options.partName || projectData.name || 'Camera Holder',
        part_number: projectData.part_number || 'Camera Holder',
        drawing_no: options.drawingNumber || projectData.drawing_number || 'A4',
        revision: projectData.revision || 'A',
        material: projectData.material || 'Aluminium 6061-T6',
        surface_treatment: projectData.surface_treatment || 'Black Anodized',
        inspection_date: new Date().toLocaleDateString('en-GB'),
        general_notes: [
          'Dimensions and tolerances mentioned are final.',
          'Check all dimensions before manufacturing.',
          'Follow drawing for reference.',
          'Do not scale the drawing.',
        ],
        inspection_details: inspectionDetails,
        raw_material: projectData.material || 'Aluminium 6061-T6',
        inspected_by: 'Thiru',
        approved_by: 'Kishore',
        balloon_diagram: balloonDiagram ? this.transformBalloonDiagramResponse(balloonDiagram) : undefined,
      };

      return report;
    } catch (error) {
      this.logger.error(`Failed to generate inspection report: ${error.message}`, error.stack);
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException('Failed to generate inspection report');
    }
  }

  async generateCompleteReport(projectId: string, userId: string): Promise<any> {
    try {
      const inspectionReport = await this.generateInspectionReport(projectId, userId);
      const balloonDiagrams = await this.getBalloonDiagrams(projectId, userId);

      return {
        balloon_drawing: {
          material: inspectionReport.material,
          surface_treatment: inspectionReport.surface_treatment,
          part_name: inspectionReport.part_name,
          drawing_no: inspectionReport.drawing_no,
          general_notes: inspectionReport.general_notes,
          section: 'A–A',
        },
        final_inspection_report: inspectionReport,
        balloon_diagrams: balloonDiagrams,
      };
    } catch (error) {
      this.logger.error(`Failed to generate complete report: ${error.message}`, error.stack);
      throw new BadRequestException('Failed to generate complete report');
    }
  }

  private transformBalloonDiagramResponse(data: any): BalloonDiagramResponseDto {
    return {
      id: data.id,
      project_id: data.project_id,
      bom_id: data.bom_id,
      name: data.name,
      cad_file_path: data.cad_file_path,
      diagram_data: data.diagram_data,
      created_at: data.created_at,
      updated_at: data.updated_at,
      annotations: (data.annotations || []).map((annotation: any) => ({
        id: annotation.id,
        bom_item_id: annotation.bom_item_id,
        balloon_number: annotation.balloon_number,
        position_x: annotation.position_x,
        position_y: annotation.position_y,
        position_z: annotation.position_z,
        annotation_text: annotation.annotation_text,
        leader_line: annotation.leader_line,
        bom_item: annotation.bom_item ? {
          part_name: annotation.bom_item.name,
          part_number: annotation.bom_item.part_number,
          material: annotation.bom_item.material,
          quantity: annotation.bom_item.quantity,
        } : undefined,
      })),
    };
  }
}