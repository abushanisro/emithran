-- Migration 144: Create delivery module tables and fix quality_approved_items columns

-- Add missing columns to quality_approved_items
ALTER TABLE quality_approved_items
    ADD COLUMN IF NOT EXISTS batch_number         VARCHAR(100),
    ADD COLUMN IF NOT EXISTS inspection_id        UUID REFERENCES quality_inspections(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS actual_weight_kg     NUMERIC(10,3),
    ADD COLUMN IF NOT EXISTS actual_dimensions_cm JSONB;

-- ── delivery_addresses ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_addresses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY
);
ALTER TABLE delivery_addresses
    ADD COLUMN IF NOT EXISTS project_id           UUID REFERENCES projects(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS address_type         VARCHAR(50) NOT NULL DEFAULT 'shipping',
    ADD COLUMN IF NOT EXISTS company_name         VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS contact_person       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_phone        VARCHAR(50),
    ADD COLUMN IF NOT EXISTS contact_email        VARCHAR(255),
    ADD COLUMN IF NOT EXISTS address_line1        TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS address_line2        TEXT,
    ADD COLUMN IF NOT EXISTS city                 VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS state_province       VARCHAR(100),
    ADD COLUMN IF NOT EXISTS postal_code          VARCHAR(20),
    ADD COLUMN IF NOT EXISTS country              VARCHAR(100) NOT NULL DEFAULT 'India',
    ADD COLUMN IF NOT EXISTS latitude             NUMERIC(10,7),
    ADD COLUMN IF NOT EXISTS longitude            NUMERIC(10,7),
    ADD COLUMN IF NOT EXISTS special_instructions TEXT,
    ADD COLUMN IF NOT EXISTS is_default           BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS created_by           UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ── carriers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carriers (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY
);
ALTER TABLE carriers
    ADD COLUMN IF NOT EXISTS name                VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS code                VARCHAR(50),
    ADD COLUMN IF NOT EXISTS contact_email       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_phone       VARCHAR(50),
    ADD COLUMN IF NOT EXISTS service_areas       JSONB,
    ADD COLUMN IF NOT EXISTS capabilities        JSONB,
    ADD COLUMN IF NOT EXISTS performance_metrics JSONB,
    ADD COLUMN IF NOT EXISTS active              BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ── delivery_orders ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_orders (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY
);
ALTER TABLE delivery_orders
    ADD COLUMN IF NOT EXISTS order_number                 VARCHAR(100),
    ADD COLUMN IF NOT EXISTS project_id                   UUID REFERENCES projects(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS inspection_id                UUID REFERENCES quality_inspections(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS delivery_address_id          UUID REFERENCES delivery_addresses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS billing_address_id           UUID REFERENCES delivery_addresses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS carrier_id                   UUID REFERENCES carriers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS status                       VARCHAR(50) NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS priority                     VARCHAR(50) NOT NULL DEFAULT 'standard',
    ADD COLUMN IF NOT EXISTS requested_delivery_date      TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS estimated_delivery_date      TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS actual_delivery_date         TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS delivery_window_start        TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS delivery_window_end          TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS total_weight_kg              NUMERIC(12,3),
    ADD COLUMN IF NOT EXISTS total_volume_m3              NUMERIC(12,4),
    ADD COLUMN IF NOT EXISTS package_count                INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS special_handling_requirements TEXT,
    ADD COLUMN IF NOT EXISTS delivery_instructions        TEXT,
    ADD COLUMN IF NOT EXISTS delivery_cost_inr            NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS insurance_cost_inr           NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS handling_cost_inr            NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_delivery_cost_inr      NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tracking_number              VARCHAR(255),
    ADD COLUMN IF NOT EXISTS carrier_reference            VARCHAR(255),
    ADD COLUMN IF NOT EXISTS pickup_date                  TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS notes                        TEXT,
    ADD COLUMN IF NOT EXISTS transport_mode               VARCHAR(50),
    ADD COLUMN IF NOT EXISTS material_type                VARCHAR(100),
    ADD COLUMN IF NOT EXISTS route_type                   VARCHAR(50),
    ADD COLUMN IF NOT EXISTS route_distance_km            NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS route_travel_time_minutes    INTEGER,
    ADD COLUMN IF NOT EXISTS route_data                   JSONB,
    ADD COLUMN IF NOT EXISTS transport_cost_inr           NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS loading_cost_inr             NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS fuel_toll_cost_inr           NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS cost_breakdown               JSONB,
    ADD COLUMN IF NOT EXISTS parts_photos                 JSONB,
    ADD COLUMN IF NOT EXISTS packing_photos               JSONB,
    ADD COLUMN IF NOT EXISTS documents                    JSONB,
    ADD COLUMN IF NOT EXISTS dock_audit                   JSONB,
    ADD COLUMN IF NOT EXISTS checked_by                   VARCHAR(255),
    ADD COLUMN IF NOT EXISTS checked_at                   TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS approved_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at                  TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS created_by                   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS updated_by                   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS created_at                   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at                   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- Unique constraint on order_number (safe to add if not already present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'delivery_orders'::regclass AND conname = 'delivery_orders_order_number_key'
  ) THEN
    ALTER TABLE delivery_orders ADD CONSTRAINT delivery_orders_order_number_key UNIQUE (order_number);
  END IF;
END $$;

-- ── delivery_items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_items (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY
);
ALTER TABLE delivery_items
    ADD COLUMN IF NOT EXISTS delivery_order_id        UUID REFERENCES delivery_orders(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS quality_approved_item_id UUID REFERENCES quality_approved_items(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS bom_item_id              UUID REFERENCES bom_items(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_quantity        NUMERIC(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_quantity        NUMERIC(12,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS requested_quantity       NUMERIC(12,3),
    ADD COLUMN IF NOT EXISTS unit_weight_kg           NUMERIC(10,3),
    ADD COLUMN IF NOT EXISTS total_weight_kg          NUMERIC(10,3),
    ADD COLUMN IF NOT EXISTS unit_dimensions_cm       JSONB,
    ADD COLUMN IF NOT EXISTS packaging_type           VARCHAR(100),
    ADD COLUMN IF NOT EXISTS packaging_instructions   TEXT,
    ADD COLUMN IF NOT EXISTS hazmat_classification    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS qc_certificate_number    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS batch_number             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS serial_numbers           JSONB,
    ADD COLUMN IF NOT EXISTS unit_value_inr           NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS total_value_inr          NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS created_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ── delivery_tracking ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_tracking (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY
);
ALTER TABLE delivery_tracking
    ADD COLUMN IF NOT EXISTS delivery_order_id   UUID REFERENCES delivery_orders(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS event_type          VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS event_description   TEXT,
    ADD COLUMN IF NOT EXISTS event_timestamp     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS location_name       VARCHAR(255),
    ADD COLUMN IF NOT EXISTS location_address    TEXT,
    ADD COLUMN IF NOT EXISTS latitude            NUMERIC(10,7),
    ADD COLUMN IF NOT EXISTS longitude           NUMERIC(10,7),
    ADD COLUMN IF NOT EXISTS carrier_status_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS internal_notes      TEXT,
    ADD COLUMN IF NOT EXISTS proof_of_delivery   JSONB,
    ADD COLUMN IF NOT EXISTS created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS created_at          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_delivery_orders_project_id                  ON delivery_orders(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status                      ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_items_delivery_order_id            ON delivery_items(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_quality_approved_item_id     ON delivery_items(quality_approved_item_id);
CREATE INDEX IF NOT EXISTS idx_delivery_tracking_delivery_order_id         ON delivery_tracking(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_addresses_project_id               ON delivery_addresses(project_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE delivery_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_orders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_tracking  ENABLE ROW LEVEL SECURITY;
ALTER TABLE carriers           ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_addresses' AND policyname = 'delivery_addresses_auth') THEN
    CREATE POLICY "delivery_addresses_auth" ON delivery_addresses FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_orders' AND policyname = 'delivery_orders_auth') THEN
    CREATE POLICY "delivery_orders_auth" ON delivery_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_items' AND policyname = 'delivery_items_auth') THEN
    CREATE POLICY "delivery_items_auth" ON delivery_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'delivery_tracking' AND policyname = 'delivery_tracking_auth') THEN
    CREATE POLICY "delivery_tracking_auth" ON delivery_tracking FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'carriers' AND policyname = 'carriers_auth') THEN
    CREATE POLICY "carriers_auth" ON carriers FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

INSERT INTO schema_migrations (version, description)
VALUES ('144', 'Create delivery tables: delivery_addresses, carriers, delivery_orders, delivery_items, delivery_tracking; add missing columns to quality_approved_items')
ON CONFLICT (version) DO NOTHING;
