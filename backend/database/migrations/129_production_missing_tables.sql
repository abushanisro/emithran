-- Migration 129: Add missing production tables and schema fixes
-- Applies content from backend/migrations/066 and 067 (never run against this DB),
-- adds remarks_and_issues.lot_id, and adds the vendor_nomination_evaluations→vendors FK
-- so PostgREST recognises the relationship.

-- ============================================================================
-- 1. production_lot_bom_items  (from 066)
-- ============================================================================
CREATE TABLE IF NOT EXISTS production_lot_bom_items (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    production_lot_id UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(production_lot_id, bom_item_id)
);

CREATE INDEX IF NOT EXISTS idx_production_lot_bom_items_lot_id
    ON production_lot_bom_items(production_lot_id);
CREATE INDEX IF NOT EXISTS idx_production_lot_bom_items_bom_item_id
    ON production_lot_bom_items(bom_item_id);

ALTER TABLE production_lot_bom_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'production_lot_bom_items'
          AND policyname = 'Users can manage production lot BOM items for their BOMs'
    ) THEN
        CREATE POLICY "Users can manage production lot BOM items for their BOMs"
            ON production_lot_bom_items FOR ALL
            USING (
                EXISTS (
                    SELECT 1 FROM production_lots pl
                    JOIN boms b ON pl.bom_id = b.id
                    WHERE pl.id = production_lot_bom_items.production_lot_id
                      AND b.user_id = auth.uid()
                )
            );
    END IF;
END $$;

-- ============================================================================
-- 2. production_lot_materials  (from 067)
-- ============================================================================
CREATE TABLE IF NOT EXISTS production_lot_materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_lot_id UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
    bom_item_id UUID NOT NULL REFERENCES bom_items(id) ON DELETE RESTRICT,
    required_quantity DECIMAL(12, 3) NOT NULL CHECK (required_quantity > 0),
    ordered_quantity DECIMAL(12, 3) DEFAULT 0,
    received_quantity DECIMAL(12, 3) DEFAULT 0,
    inspected_quantity DECIMAL(12, 3) DEFAULT 0,
    approved_quantity DECIMAL(12, 3) DEFAULT 0,
    rejected_quantity DECIMAL(12, 3) DEFAULT 0,
    consumed_quantity DECIMAL(12, 3) DEFAULT 0,
    material_status VARCHAR(50) DEFAULT 'planning' CHECK (
        material_status IN ('planning', 'ordered', 'shipped', 'received', 'inspected', 'approved', 'in_use', 'depleted')
    ),
    assigned_vendor_id UUID REFERENCES vendors(id),
    unit_cost DECIMAL(10, 2) DEFAULT 0,
    total_cost DECIMAL(15, 2) DEFAULT 0,
    estimated_cost DECIMAL(15, 2) DEFAULT 0,
    actual_cost DECIMAL(15, 2),
    expected_delivery_date DATE,
    actual_delivery_date DATE,
    received_date DATE,
    inspection_date DATE,
    approval_date DATE,
    specifications TEXT,
    criticality VARCHAR(20) DEFAULT 'medium' CHECK (criticality IN ('low', 'medium', 'high', 'critical')),
    lead_time_days INTEGER DEFAULT 0,
    buffer_stock DECIMAL(10, 3) DEFAULT 0,
    reorder_point DECIMAL(10, 3) DEFAULT 0,
    batch_number VARCHAR(100),
    lot_number VARCHAR(100),
    storage_location VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(production_lot_id, bom_item_id)
);

CREATE INDEX IF NOT EXISTS idx_prod_lot_materials_lot_id   ON production_lot_materials(production_lot_id);
CREATE INDEX IF NOT EXISTS idx_prod_lot_materials_bom_item ON production_lot_materials(bom_item_id);
CREATE INDEX IF NOT EXISTS idx_prod_lot_materials_status   ON production_lot_materials(material_status);
CREATE INDEX IF NOT EXISTS idx_prod_lot_materials_vendor   ON production_lot_materials(assigned_vendor_id);

ALTER TABLE production_lot_materials ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'production_lot_materials'
          AND policyname = 'Users can manage materials for their production lots'
    ) THEN
        CREATE POLICY "Users can manage materials for their production lots"
            ON production_lot_materials FOR ALL
            USING (EXISTS (
                SELECT 1 FROM production_lots pl
                JOIN boms b ON b.id = pl.bom_id
                WHERE pl.id = production_lot_materials.production_lot_id
                  AND b.user_id = auth.uid()
            ));
    END IF;
END $$;

-- ============================================================================
-- 3. material_tracking_history  (from 067)
-- ============================================================================
CREATE TABLE IF NOT EXISTS material_tracking_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_lot_material_id UUID NOT NULL REFERENCES production_lot_materials(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL CHECK (
        action IN ('ordered', 'shipped', 'received', 'inspected', 'approved', 'rejected', 'consumed', 'returned', 'adjusted')
    ),
    quantity DECIMAL(12, 3) NOT NULL,
    previous_quantity DECIMAL(12, 3) DEFAULT 0,
    new_quantity DECIMAL(12, 3) NOT NULL,
    batch_number VARCHAR(100),
    supplier_reference VARCHAR(255),
    storage_location VARCHAR(255),
    notes TEXT,
    quality_notes TEXT,
    performed_by UUID NOT NULL REFERENCES auth.users(id),
    performed_by_name VARCHAR(255),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mat_tracking_history_material ON material_tracking_history(production_lot_material_id);
CREATE INDEX IF NOT EXISTS idx_mat_tracking_history_date     ON material_tracking_history(performed_at);

ALTER TABLE material_tracking_history ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'material_tracking_history'
          AND policyname = 'Users can view tracking history for their materials'
    ) THEN
        CREATE POLICY "Users can view tracking history for their materials"
            ON material_tracking_history FOR ALL
            USING (EXISTS (
                SELECT 1 FROM production_lot_materials plm
                JOIN production_lots pl ON pl.id = plm.production_lot_id
                JOIN boms b ON b.id = pl.bom_id
                WHERE plm.id = material_tracking_history.production_lot_material_id
                  AND b.user_id = auth.uid()
            ));
    END IF;
END $$;

-- ============================================================================
-- 4. production_material_alerts  (from 067)
-- ============================================================================
CREATE TABLE IF NOT EXISTS production_material_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_lot_id UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
    production_lot_material_id UUID REFERENCES production_lot_materials(id) ON DELETE CASCADE,
    production_process_id UUID REFERENCES production_processes(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL CHECK (
        alert_type IN ('delay', 'shortage', 'quality', 'reorder', 'expiry', 'process_blocked', 'vendor_issue')
    ),
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    source VARCHAR(20) NOT NULL CHECK (source IN ('monitoring', 'bom', 'system', 'manual')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    impact_description TEXT,
    suggested_action TEXT,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved', 'dismissed')),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES auth.users(id),
    resolution_notes TEXT,
    affected_processes JSONB DEFAULT '[]',
    affected_materials JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prod_alerts_lot_id    ON production_material_alerts(production_lot_id);
CREATE INDEX IF NOT EXISTS idx_prod_alerts_type      ON production_material_alerts(alert_type, severity);
CREATE INDEX IF NOT EXISTS idx_prod_alerts_status    ON production_material_alerts(status);
CREATE INDEX IF NOT EXISTS idx_prod_alerts_created   ON production_material_alerts(created_at);

ALTER TABLE production_material_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'production_material_alerts'
          AND policyname = 'Users can manage alerts for their production lots'
    ) THEN
        CREATE POLICY "Users can manage alerts for their production lots"
            ON production_material_alerts FOR ALL
            USING (EXISTS (
                SELECT 1 FROM production_lots pl
                JOIN boms b ON b.id = pl.bom_id
                WHERE pl.id = production_material_alerts.production_lot_id
                  AND b.user_id = auth.uid()
            ));
    END IF;
END $$;

-- ============================================================================
-- 5. production_monitoring_metrics  (from 067)
-- ============================================================================
CREATE TABLE IF NOT EXISTS production_monitoring_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    production_lot_id UUID NOT NULL REFERENCES production_lots(id) ON DELETE CASCADE,
    production_process_id UUID REFERENCES production_processes(id) ON DELETE CASCADE,
    metric_date DATE NOT NULL,
    metric_type VARCHAR(50) NOT NULL CHECK (
        metric_type IN ('production_output', 'quality_rate', 'efficiency', 'downtime', 'material_consumption')
    ),
    planned_output INTEGER DEFAULT 0,
    actual_output INTEGER DEFAULT 0,
    accepted_output INTEGER DEFAULT 0,
    rejected_output INTEGER DEFAULT 0,
    rework_output INTEGER DEFAULT 0,
    quality_rate DECIMAL(5, 2) DEFAULT 0,
    first_pass_yield DECIMAL(5, 2) DEFAULT 0,
    defect_rate DECIMAL(5, 2) DEFAULT 0,
    efficiency_percentage DECIMAL(5, 2) DEFAULT 0,
    utilization_rate DECIMAL(5, 2) DEFAULT 0,
    throughput_rate DECIMAL(10, 2) DEFAULT 0,
    planned_hours DECIMAL(8, 2) DEFAULT 0,
    actual_hours DECIMAL(8, 2) DEFAULT 0,
    downtime_hours DECIMAL(8, 2) DEFAULT 0,
    downtime_reason TEXT,
    material_efficiency DECIMAL(5, 2) DEFAULT 0,
    waste_percentage DECIMAL(5, 2) DEFAULT 0,
    shift VARCHAR(50),
    operator_count INTEGER DEFAULT 1,
    notes TEXT,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(production_lot_id, production_process_id, metric_date, metric_type)
);

CREATE INDEX IF NOT EXISTS idx_prod_metrics_lot_id ON production_monitoring_metrics(production_lot_id);
CREATE INDEX IF NOT EXISTS idx_prod_metrics_date   ON production_monitoring_metrics(metric_date);

ALTER TABLE production_monitoring_metrics ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'production_monitoring_metrics'
          AND policyname = 'Users can manage metrics for their production lots'
    ) THEN
        CREATE POLICY "Users can manage metrics for their production lots"
            ON production_monitoring_metrics FOR ALL
            USING (EXISTS (
                SELECT 1 FROM production_lots pl
                JOIN boms b ON b.id = pl.bom_id
                WHERE pl.id = production_monitoring_metrics.production_lot_id
                  AND b.user_id = auth.uid()
            ));
    END IF;
END $$;

-- ============================================================================
-- 6. updated_at triggers for new tables
-- ============================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_production_lot_materials_updated_at') THEN
        CREATE TRIGGER update_production_lot_materials_updated_at
            BEFORE UPDATE ON production_lot_materials
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_production_material_alerts_updated_at') THEN
        CREATE TRIGGER update_production_material_alerts_updated_at
            BEFORE UPDATE ON production_material_alerts
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_production_monitoring_metrics_updated_at') THEN
        CREATE TRIGGER update_production_monitoring_metrics_updated_at
            BEFORE UPDATE ON production_monitoring_metrics
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ============================================================================
-- 7. remarks_and_issues.lot_id  (column was never added)
-- ============================================================================
ALTER TABLE remarks_and_issues
    ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES production_lots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_remarks_and_issues_lot_id
    ON remarks_and_issues(lot_id) WHERE lot_id IS NOT NULL;

-- ============================================================================
-- 8. vendor_nomination_evaluations → vendors FK
-- PostgREST needs an explicit FK to resolve the relationship in schema cache.
-- ============================================================================
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_vendor_nomination_evaluations_vendor_id'
    ) THEN
        ALTER TABLE vendor_nomination_evaluations
            ADD CONSTRAINT fk_vendor_nomination_evaluations_vendor_id
            FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_nomination_evaluations_vendor_id
    ON vendor_nomination_evaluations(vendor_id);

-- ============================================================================
-- Migration log
-- ============================================================================
INSERT INTO schema_migrations (version, description)
VALUES ('129', 'Add production_lot_bom_items, production_lot_materials, alerts, metrics; add remarks_and_issues.lot_id; add vendor_nomination_evaluations→vendors FK')
ON CONFLICT (version) DO NOTHING;
