-- Project Reports Database Schema Migration

-- Create balloon_diagrams table
CREATE TABLE IF NOT EXISTS balloon_diagrams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cad_file_path TEXT,
  diagram_data JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create diagram_annotations table
CREATE TABLE IF NOT EXISTS diagram_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balloon_diagram_id UUID NOT NULL REFERENCES balloon_diagrams(id) ON DELETE CASCADE,
  bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
  balloon_number INTEGER NOT NULL,
  position_x REAL NOT NULL,
  position_y REAL NOT NULL,
  position_z REAL DEFAULT 0,
  annotation_text TEXT,
  leader_line JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_balloon_diagrams_project_id ON balloon_diagrams(project_id);
CREATE INDEX IF NOT EXISTS idx_balloon_diagrams_bom_id ON balloon_diagrams(bom_id);
CREATE INDEX IF NOT EXISTS idx_diagram_annotations_balloon_diagram_id ON diagram_annotations(balloon_diagram_id);
CREATE INDEX IF NOT EXISTS idx_diagram_annotations_bom_item_id ON diagram_annotations(bom_item_id);
CREATE INDEX IF NOT EXISTS idx_diagram_annotations_balloon_number ON diagram_annotations(balloon_number);

-- Add unique constraint for balloon numbers within a diagram
ALTER TABLE diagram_annotations ADD CONSTRAINT unique_balloon_number_per_diagram 
UNIQUE (balloon_diagram_id, balloon_number);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_balloon_diagrams_updated_at 
    BEFORE UPDATE ON balloon_diagrams 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_diagram_annotations_updated_at 
    BEFORE UPDATE ON diagram_annotations 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE balloon_diagrams ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagram_annotations ENABLE ROW LEVEL SECURITY;

-- RLS policies for balloon_diagrams
CREATE POLICY "Users can view balloon diagrams for their projects" ON balloon_diagrams
    FOR SELECT USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "Users can create balloon diagrams for their projects" ON balloon_diagrams
    FOR INSERT WITH CHECK (
        created_by = auth.uid() AND
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "Users can update their balloon diagrams" ON balloon_diagrams
    FOR UPDATE USING (
        created_by = auth.uid() OR
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

CREATE POLICY "Users can delete their balloon diagrams" ON balloon_diagrams
    FOR DELETE USING (
        created_by = auth.uid() OR
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
            )
        )
    );

-- RLS policies for diagram_annotations
CREATE POLICY "Users can view annotations for accessible diagrams" ON diagram_annotations
    FOR SELECT USING (
        balloon_diagram_id IN (
            SELECT id FROM balloon_diagrams WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can create annotations for accessible diagrams" ON diagram_annotations
    FOR INSERT WITH CHECK (
        created_by = auth.uid() AND
        balloon_diagram_id IN (
            SELECT id FROM balloon_diagrams WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can update annotations for accessible diagrams" ON diagram_annotations
    FOR UPDATE USING (
        created_by = auth.uid() OR
        balloon_diagram_id IN (
            SELECT id FROM balloon_diagrams WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

CREATE POLICY "Users can delete annotations for accessible diagrams" ON diagram_annotations
    FOR DELETE USING (
        created_by = auth.uid() OR
        balloon_diagram_id IN (
            SELECT id FROM balloon_diagrams WHERE 
            project_id IN (
                SELECT id FROM projects WHERE user_id = auth.uid() OR id IN (
                    SELECT project_id FROM project_team_members WHERE user_id::uuid = auth.uid()
                )
            )
        )
    );

-- Grant permissions
GRANT ALL ON balloon_diagrams TO authenticated;
GRANT ALL ON diagram_annotations TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE balloon_diagrams IS 'Stores balloon diagrams with CAD file references and annotation data';
COMMENT ON TABLE diagram_annotations IS 'Stores individual annotations/balloons within diagrams with positioning and BOM item references';

COMMENT ON COLUMN balloon_diagrams.diagram_data IS 'JSON data containing diagram configuration, view settings, and metadata';
COMMENT ON COLUMN diagram_annotations.leader_line IS 'JSON data containing leader line coordinates and styling';
COMMENT ON COLUMN diagram_annotations.position_z IS 'Z-coordinate for 3D diagrams, defaults to 0 for 2D';