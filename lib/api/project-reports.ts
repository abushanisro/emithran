import { apiClient } from './client';

export interface BalloonDiagramAnnotation {
  id: string;
  bom_item_id: string;
  balloon_number: number;
  position_x: number;
  position_y: number;
  position_z?: number;
  annotation_text?: string;
  leader_line?: any;
  bom_item?: {
    part_name: string;
    part_number: string;
    material: string;
    quantity: number;
  };
}

export interface BalloonDiagram {
  id: string;
  project_id: string;
  bom_id: string;
  name: string;
  cad_file_path?: string;
  diagram_data?: any;
  created_at: string;
  updated_at: string;
  annotations: BalloonDiagramAnnotation[];
}

export interface InspectionDetail {
  s_no: number;
  description: string;
  specification: string;
  gt: number;
  lt: number;
  uom: string;
  measurements: number[];
  remarks?: string;
}

export interface InspectionReport {
  company_name: string;
  part_name: string;
  part_number: string;
  drawing_no: string;
  revision: string;
  material: string;
  surface_treatment: string;
  inspection_date: string;
  general_notes: string[];
  inspection_details: InspectionDetail[];
  raw_material: string;
  inspected_by: string;
  approved_by: string;
  balloon_diagram?: BalloonDiagram;
}

export interface CompleteProjectReport {
  balloon_drawing: {
    material: string;
    surface_treatment: string;
    part_name: string;
    drawing_no: string;
    general_notes: string[];
    section: string;
  };
  final_inspection_report: InspectionReport;
  balloon_diagrams: BalloonDiagram[];
}

export interface CreateBalloonDiagramRequest {
  project_id: string;
  bom_id: string;
  name: string;
  cad_file_path?: string;
  diagram_data?: any;
}

export interface UpdateBalloonDiagramRequest {
  name?: string;
  cad_file_path?: string;
  diagram_data?: any;
}

export interface DiagramAnnotationRequest {
  bom_item_id: string;
  balloon_number: number;
  position_x: number;
  position_y: number;
  position_z?: number;
  annotation_text?: string;
  leader_line?: any;
}

class ProjectReportsApi {
  constructor(private client: typeof apiClient) {}

  async createBalloonDiagram(data: CreateBalloonDiagramRequest): Promise<BalloonDiagram> {
    const response = await this.client.post('/project-reports/balloon-diagrams', data);
    return response.data;
  }

  async getBalloonDiagrams(projectId: string): Promise<BalloonDiagram[]> {
    const response = await this.client.get(`/project-reports/projects/${projectId}/balloon-diagrams`);
    return response.data;
  }

  async getBalloonDiagram(id: string): Promise<BalloonDiagram> {
    const response = await this.client.get(`/project-reports/balloon-diagrams/${id}`);
    return response.data;
  }

  async updateBalloonDiagram(id: string, data: UpdateBalloonDiagramRequest): Promise<BalloonDiagram> {
    const response = await this.client.put(`/project-reports/balloon-diagrams/${id}`, data);
    return response.data;
  }

  async deleteBalloonDiagram(id: string): Promise<void> {
    await this.client.delete(`/project-reports/balloon-diagrams/${id}`);
  }

  async addAnnotation(diagramId: string, data: DiagramAnnotationRequest): Promise<BalloonDiagramAnnotation> {
    const response = await this.client.post(`/project-reports/balloon-diagrams/${diagramId}/annotations`, data);
    return response.data;
  }

  async updateAnnotation(
    diagramId: string,
    annotationId: string,
    data: DiagramAnnotationRequest
  ): Promise<BalloonDiagramAnnotation> {
    const response = await this.client.put(
      `/project-reports/balloon-diagrams/${diagramId}/annotations/${annotationId}`,
      data
    );
    return response.data;
  }

  async deleteAnnotation(diagramId: string, annotationId: string): Promise<void> {
    await this.client.delete(`/project-reports/balloon-diagrams/${diagramId}/annotations/${annotationId}`);
  }

  async generateInspectionReport(
    projectId: string,
    options?: { partName?: string; drawingNumber?: string }
  ): Promise<InspectionReport> {
    const params = new URLSearchParams();
    if (options?.partName) params.append('partName', options.partName);
    if (options?.drawingNumber) params.append('drawingNumber', options.drawingNumber);
    
    const response = await this.client.get(
      `/project-reports/projects/${projectId}/inspection-report?${params.toString()}`
    );
    return response.data;
  }

  async generateCompleteReport(projectId: string): Promise<CompleteProjectReport> {
    const response = await this.client.get(`/project-reports/projects/${projectId}/complete-report`);
    return response.data;
  }
}

export const projectReportsApi = new ProjectReportsApi(apiClient);