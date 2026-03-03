-- ================================================================
-- DELIVERY ATTACHMENTS
-- Stores parts photos, packing photos, and documents for delivery orders
-- ================================================================

-- Create delivery_attachments table
CREATE TABLE IF NOT EXISTS delivery_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('parts_photo', 'packing_photo', 'document')),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,       -- path inside the storage bucket
  file_url TEXT,                 -- public/signed URL (optional cache)
  file_size_bytes BIGINT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_delivery_attachments_order_id
  ON delivery_attachments (delivery_order_id);

CREATE INDEX IF NOT EXISTS idx_delivery_attachments_category
  ON delivery_attachments (category);

-- Updated-at trigger
CREATE OR REPLACE FUNCTION update_delivery_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delivery_attachments_updated_at ON delivery_attachments;
CREATE TRIGGER trg_delivery_attachments_updated_at
  BEFORE UPDATE ON delivery_attachments
  FOR EACH ROW EXECUTE FUNCTION update_delivery_attachments_updated_at();

-- RLS
ALTER TABLE delivery_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert attachments"
  ON delivery_attachments FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read attachments"
  ON delivery_attachments FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Owners can delete their attachments"
  ON delivery_attachments FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid());

-- ================================================================
-- STORAGE BUCKET (run in Supabase dashboard if not already created)
-- ================================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('delivery-attachments', 'delivery-attachments', false)
-- ON CONFLICT (id) DO NOTHING;

-- Storage RLS policies (run after bucket exists):
-- CREATE POLICY "Authenticated upload" ON storage.objects FOR INSERT TO authenticated
--   WITH CHECK (bucket_id = 'delivery-attachments');
-- CREATE POLICY "Authenticated download" ON storage.objects FOR SELECT TO authenticated
--   USING (bucket_id = 'delivery-attachments');
-- CREATE POLICY "Owner delete" ON storage.objects FOR DELETE TO authenticated
--   USING (bucket_id = 'delivery-attachments' AND owner = auth.uid()::text);
