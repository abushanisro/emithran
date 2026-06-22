-- Add separate DXF/DWG path column so CAD drawings are independent of 2D PDF/image drawings
ALTER TABLE bom_items ADD COLUMN IF NOT EXISTS file_dxf_path TEXT;
