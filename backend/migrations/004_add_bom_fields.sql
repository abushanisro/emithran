-- ============================================================================
-- Migration: Add missing BOM fields
-- Description: Adds version, status, metrics, and approval tracking to BOMs table
-- ============================================================================

-- Add missing columns to boms table
ALTER TABLE boms
ADD COLUMN IF NOT EXISTS version VARCHAR(50) DEFAULT '1.0' NOT NULL,
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'draft' NOT NULL
  CHECK (status IN ('draft', 'approved', 'released', 'obsolete')),
ADD COLUMN IF NOT EXISTS total_items INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN IF NOT EXISTS total_cost DECIMAL(15,2),
ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;

-- Add indexes for filtering and sorting
CREATE INDEX IF NOT EXISTS idx_boms_status ON boms(status);
CREATE INDEX IF NOT EXISTS idx_boms_version ON boms(version);
CREATE INDEX IF NOT EXISTS idx_boms_approved_by ON boms(approved_by) WHERE approved_by IS NOT NULL;

-- Create function to auto-update total_items when bom_items change
CREATE OR REPLACE FUNCTION update_bom_total_items()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE boms
  SET
    total_items = (
      SELECT COUNT(*)
      FROM bom_items
      WHERE bom_id = COALESCE(NEW.bom_id, OLD.bom_id)
    ),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.bom_id, OLD.bom_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update total_items
DROP TRIGGER IF EXISTS trigger_update_bom_total_items ON bom_items;
CREATE TRIGGER trigger_update_bom_total_items
  AFTER INSERT OR DELETE ON bom_items
  FOR EACH ROW
  EXECUTE FUNCTION update_bom_total_items();

-- Add comment
COMMENT ON COLUMN boms.version IS 'BOM version identifier (e.g., 1.0, 1.1, 2.0)';
COMMENT ON COLUMN boms.status IS 'BOM lifecycle status: draft, approved, released, or obsolete';
COMMENT ON COLUMN boms.total_items IS 'Cached count of items in this BOM (auto-updated via trigger)';
COMMENT ON COLUMN boms.total_cost IS 'Sum of all item costs (can be calculated or manually set)';
COMMENT ON COLUMN boms.approved_by IS 'User who approved this BOM';
COMMENT ON COLUMN boms.approved_at IS 'Timestamp when BOM was approved';
