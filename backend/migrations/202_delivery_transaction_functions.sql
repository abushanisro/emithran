-- =====================================================
-- Delivery Module Transaction Functions
-- Production-ready stored procedures for complex operations
-- =====================================================

-- Function to create delivery order with full transaction support
CREATE OR REPLACE FUNCTION create_delivery_order_transaction(
  order_data JSONB,
  items_data JSONB
) RETURNS JSONB AS $$
DECLARE
  new_order_id UUID;
  new_order_number VARCHAR(50);
  order_result RECORD;
  item JSONB;
  total_weight DECIMAL(10,3) := 0;
  total_volume DECIMAL(10,6) := 0;
  total_value DECIMAL(15,2) := 0;
  item_weight DECIMAL(10,3);
  item_volume DECIMAL(10,6);
  item_value DECIMAL(15,2);
  dimensions VARCHAR[];
  volume_cm3 DECIMAL(15,6);
BEGIN
  -- Validate required fields
  IF order_data->>'project_id' IS NULL THEN
    RAISE EXCEPTION 'project_id is required';
  END IF;

  IF order_data->>'delivery_address_id' IS NULL THEN
    RAISE EXCEPTION 'delivery_address_id is required';
  END IF;

  IF order_data->>'created_by' IS NULL THEN
    RAISE EXCEPTION 'created_by is required';
  END IF;

  -- Validate that all quality approved items are available and not already in delivery
  FOR item IN SELECT * FROM jsonb_array_elements(items_data)
  LOOP
    -- Check if item exists and is approved
    IF NOT EXISTS (
      SELECT 1 FROM quality_approved_items qai
      WHERE qai.id = (item->>'quality_approved_item_id')::UUID
      AND qai.approval_status = 'approved'
      AND qai.delivery_ready = true
    ) THEN
      RAISE EXCEPTION 'Quality approved item % is not available for delivery', item->>'quality_approved_item_id';
    END IF;

    -- Check if item is not already in another delivery
    IF EXISTS (
      SELECT 1 FROM delivery_items di
      WHERE di.quality_approved_item_id = (item->>'quality_approved_item_id')::UUID
    ) THEN
      RAISE EXCEPTION 'Quality approved item % is already in another delivery order', item->>'quality_approved_item_id';
    END IF;

    -- Validate delivery quantity doesn't exceed approved quantity
    IF (item->>'delivery_quantity')::INTEGER > (
      SELECT qai.approved_quantity FROM quality_approved_items qai
      WHERE qai.id = (item->>'quality_approved_item_id')::UUID
    ) THEN
      RAISE EXCEPTION 'Delivery quantity exceeds approved quantity for item %', item->>'quality_approved_item_id';
    END IF;
  END LOOP;

  -- Validate delivery address belongs to project
  IF NOT EXISTS (
    SELECT 1 FROM delivery_addresses da
    WHERE da.id = (order_data->>'delivery_address_id')::UUID
    AND da.project_id = (order_data->>'project_id')::UUID
  ) THEN
    RAISE EXCEPTION 'Delivery address does not belong to the specified project';
  END IF;

  -- Validate billing address if provided
  IF order_data->>'billing_address_id' IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM delivery_addresses da
      WHERE da.id = (order_data->>'billing_address_id')::UUID
      AND da.project_id = (order_data->>'project_id')::UUID
    ) THEN
      RAISE EXCEPTION 'Billing address does not belong to the specified project';
    END IF;
  END IF;

  -- Validate carrier if provided
  IF order_data->>'carrier_id' IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM carriers c
      WHERE c.id = (order_data->>'carrier_id')::UUID
      AND c.active = true
    ) THEN
      RAISE EXCEPTION 'Selected carrier is not active or does not exist';
    END IF;
  END IF;

  -- Create the delivery order
  INSERT INTO delivery_orders (
    project_id,
    inspection_id,
    delivery_address_id,
    billing_address_id,
    carrier_id,
    status,
    priority,
    requested_delivery_date,
    estimated_delivery_date,
    delivery_window_start,
    delivery_window_end,
    package_count,
    special_handling_requirements,
    delivery_instructions,
    delivery_cost_inr,
    insurance_cost_inr,
    handling_cost_inr,
    total_delivery_cost_inr,
    notes,
    created_by
  ) VALUES (
    (order_data->>'project_id')::UUID,
    NULLIF(order_data->>'inspection_id', '')::UUID,
    (order_data->>'delivery_address_id')::UUID,
    NULLIF(order_data->>'billing_address_id', '')::UUID,
    NULLIF(order_data->>'carrier_id', '')::UUID,
    'draft',
    COALESCE(order_data->>'priority', 'standard'),
    NULLIF(order_data->>'requested_delivery_date', '')::DATE,
    NULLIF(order_data->>'estimated_delivery_date', '')::DATE,
    NULLIF(order_data->>'delivery_window_start', '')::TIME,
    NULLIF(order_data->>'delivery_window_end', '')::TIME,
    COALESCE((order_data->>'package_count')::INTEGER, 1),
    order_data->>'special_handling_requirements',
    order_data->>'delivery_instructions',
    COALESCE((order_data->>'delivery_cost_inr')::DECIMAL, 0),
    COALESCE((order_data->>'insurance_cost_inr')::DECIMAL, 0),
    COALESCE((order_data->>'handling_cost_inr')::DECIMAL, 0),
    COALESCE((order_data->>'delivery_cost_inr')::DECIMAL, 0) +
    COALESCE((order_data->>'insurance_cost_inr')::DECIMAL, 0) +
    COALESCE((order_data->>'handling_cost_inr')::DECIMAL, 0),
    order_data->>'notes',
    (order_data->>'created_by')::UUID
  )
  RETURNING id, order_number INTO new_order_id, new_order_number;

  -- Insert delivery items and calculate totals
  FOR item IN SELECT * FROM jsonb_array_elements(items_data)
  LOOP
    -- Calculate item weight
    item_weight := COALESCE((item->>'unit_weight_kg')::DECIMAL, 0) * (item->>'delivery_quantity')::INTEGER;
    total_weight := total_weight + item_weight;

    -- Calculate item volume from dimensions if provided
    item_volume := 0;
    IF item->>'unit_dimensions_cm' IS NOT NULL AND item->>'unit_dimensions_cm' != '' THEN
      dimensions := string_to_array(item->>'unit_dimensions_cm', 'x');
      IF array_length(dimensions, 1) = 3 THEN
        -- Convert dimensions from cm to m³
        volume_cm3 := (TRIM(dimensions[1]))::DECIMAL * 
                     (TRIM(dimensions[2]))::DECIMAL * 
                     (TRIM(dimensions[3]))::DECIMAL;
        item_volume := (volume_cm3 / 1000000) * (item->>'delivery_quantity')::INTEGER;
        total_volume := total_volume + item_volume;
      END IF;
    END IF;

    -- Calculate item value
    item_value := COALESCE((item->>'unit_value_inr')::DECIMAL, 0) * (item->>'delivery_quantity')::INTEGER;
    total_value := total_value + item_value;

    -- Insert delivery item
    INSERT INTO delivery_items (
      delivery_order_id,
      quality_approved_item_id,
      bom_item_id,
      approved_quantity,
      delivery_quantity,
      unit_weight_kg,
      unit_dimensions_cm,
      total_weight_kg,
      packaging_type,
      packaging_instructions,
      hazmat_classification,
      qc_certificate_number,
      batch_number,
      serial_numbers,
      unit_value_inr,
      total_value_inr
    ) VALUES (
      new_order_id,
      (item->>'quality_approved_item_id')::UUID,
      (item->>'bom_item_id')::UUID,
      (item->>'approved_quantity')::INTEGER,
      (item->>'delivery_quantity')::INTEGER,
      NULLIF(item->>'unit_weight_kg', '')::DECIMAL,
      NULLIF(item->>'unit_dimensions_cm', ''),
      item_weight,
      item->>'packaging_type',
      item->>'packaging_instructions',
      item->>'hazmat_classification',
      item->>'qc_certificate_number',
      item->>'batch_number',
      CASE 
        WHEN item->>'serial_numbers' IS NOT NULL THEN item->>'serial_numbers'
        ELSE NULL 
      END,
      NULLIF(item->>'unit_value_inr', '')::DECIMAL,
      item_value
    );
  END LOOP;

  -- Update order with calculated totals
  UPDATE delivery_orders
  SET 
    total_weight_kg = total_weight,
    total_volume_m3 = total_volume,
    updated_at = NOW()
  WHERE id = new_order_id;

  -- Create initial tracking event
  INSERT INTO delivery_tracking (
    delivery_order_id,
    event_type,
    event_description,
    event_timestamp,
    internal_notes,
    created_by
  ) VALUES (
    new_order_id,
    'order_created',
    'Delivery order created and pending approval',
    NOW(),
    'Created via delivery order transaction by user ' || (order_data->>'created_by'),
    (order_data->>'created_by')::UUID
  );

  -- Return the created order information
  SELECT 
    dord.id,
    dord.order_number,
    dord.project_id,
    dord.status,
    dord.priority,
    dord.total_weight_kg,
    dord.total_volume_m3,
    dord.total_delivery_cost_inr,
    dord.created_at
  INTO order_result
  FROM delivery_orders dord
  WHERE dord.id = new_order_id;

  RETURN jsonb_build_object(
    'id', order_result.id,
    'order_number', order_result.order_number,
    'project_id', order_result.project_id,
    'status', order_result.status,
    'priority', order_result.priority,
    'total_weight_kg', order_result.total_weight_kg,
    'total_volume_m3', order_result.total_volume_m3,
    'total_delivery_cost_inr', order_result.total_delivery_cost_inr,
    'created_at', order_result.created_at
  );

EXCEPTION
  WHEN OTHERS THEN
    -- Re-raise the exception with context
    RAISE EXCEPTION 'Failed to create delivery order: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to bulk update delivery order status with tracking
CREATE OR REPLACE FUNCTION update_delivery_order_status_bulk(
  order_ids UUID[],
  new_status delivery_status,
  tracking_event_type VARCHAR DEFAULT NULL,
  tracking_description TEXT DEFAULT NULL,
  updated_by_user UUID DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER := 0;
  order_id UUID;
  old_status delivery_status;
BEGIN
  -- Validate status transition
  IF new_status NOT IN ('draft', 'pending_approval', 'approved', 'in_transit', 'out_for_delivery', 'delivered', 'failed_delivery', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid delivery status: %', new_status;
  END IF;

  -- Update each order
  FOREACH order_id IN ARRAY order_ids
  LOOP
    -- Get current status
    SELECT status INTO old_status
    FROM delivery_orders
    WHERE id = order_id;

    IF old_status IS NULL THEN
      CONTINUE; -- Skip non-existent orders
    END IF;

    -- Prevent invalid status transitions
    IF old_status IN ('delivered', 'cancelled') AND new_status != 'cancelled' THEN
      CONTINUE; -- Skip orders that can't be updated
    END IF;

    -- Update the order
    UPDATE delivery_orders
    SET 
      status = new_status,
      updated_at = NOW(),
      updated_by = COALESCE(updated_by_user, updated_by),
      actual_delivery_date = CASE 
        WHEN new_status = 'delivered' THEN NOW()
        ELSE actual_delivery_date
      END
    WHERE id = order_id;

    -- Add tracking event if specified
    IF tracking_event_type IS NOT NULL THEN
      INSERT INTO delivery_tracking (
        delivery_order_id,
        event_type,
        event_description,
        event_timestamp,
        internal_notes,
        created_by
      ) VALUES (
        order_id,
        tracking_event_type,
        COALESCE(tracking_description, 'Status changed from ' || old_status || ' to ' || new_status),
        NOW(),
        'Bulk status update by user ' || COALESCE(updated_by_user::TEXT, 'system'),
        COALESCE(updated_by_user, auth.uid())
      );
    END IF;

    updated_count := updated_count + 1;
  END LOOP;

  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate delivery performance metrics
CREATE OR REPLACE FUNCTION calculate_delivery_metrics(
  project_id_filter UUID DEFAULT NULL,
  start_date TIMESTAMP DEFAULT NULL,
  end_date TIMESTAMP DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  metrics JSONB;
  total_orders INTEGER;
  delivered_orders INTEGER;
  on_time_deliveries INTEGER;
  avg_cost DECIMAL;
  avg_delay_days DECIMAL;
  total_cost DECIMAL;
  carrier_performance JSONB;
BEGIN
  -- Build base query conditions
  WITH delivery_stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
      COUNT(*) FILTER (
        WHERE status = 'delivered' 
        AND actual_delivery_date <= requested_delivery_date
      ) as on_time,
      AVG(total_delivery_cost_inr) as avg_cost,
      SUM(total_delivery_cost_inr) as total_cost,
      AVG(
        CASE 
          WHEN status = 'delivered' AND actual_delivery_date IS NOT NULL AND requested_delivery_date IS NOT NULL
          THEN EXTRACT(DAY FROM (actual_delivery_date - requested_delivery_date))
          ELSE NULL
        END
      ) as avg_delay
    FROM delivery_orders
    WHERE 1=1
      AND (project_id_filter IS NULL OR project_id = project_id_filter)
      AND (start_date IS NULL OR created_at >= start_date)
      AND (end_date IS NULL OR created_at <= end_date)
      AND status != 'cancelled'
  ),
  carrier_stats AS (
    SELECT 
      c.id,
      c.name,
      COUNT(dord.id) as total_orders,
      COUNT(dord.id) FILTER (WHERE dord.status = 'delivered') as delivered_orders,
      COUNT(dord.id) FILTER (
        WHERE dord.status = 'delivered' 
        AND dord.actual_delivery_date <= dord.requested_delivery_date
      ) as on_time_orders,
      AVG(dord.total_delivery_cost_inr) as avg_cost
    FROM carriers c
    LEFT JOIN delivery_orders dord ON c.id = dord.carrier_id
    WHERE c.active = true
      AND (project_id_filter IS NULL OR dord.project_id = project_id_filter)
      AND (start_date IS NULL OR dord.created_at >= start_date)
      AND (end_date IS NULL OR dord.created_at <= end_date)
      AND (dord.status != 'cancelled' OR dord.status IS NULL)
    GROUP BY c.id, c.name
    HAVING COUNT(dord.id) > 0
  )
  SELECT 
    jsonb_build_object(
      'totalDeliveries', ds.total,
      'deliveredCount', ds.delivered,
      'onTimeDeliveries', ds.on_time,
      'deliverySuccessRate', 
        CASE WHEN ds.total > 0 
          THEN ROUND((ds.delivered::DECIMAL / ds.total * 100)::NUMERIC, 2)
          ELSE 0 
        END,
      'onTimeDeliveryRate',
        CASE WHEN ds.delivered > 0
          THEN ROUND((ds.on_time::DECIMAL / ds.delivered * 100)::NUMERIC, 2)
          ELSE 0
        END,
      'avgDeliveryCost', ROUND(COALESCE(ds.avg_cost, 0)::NUMERIC, 2),
      'totalDeliveryCost', ROUND(COALESCE(ds.total_cost, 0)::NUMERIC, 2),
      'avgDelayDays', ROUND(COALESCE(ds.avg_delay, 0)::NUMERIC, 1),
      'carrierPerformance', (
        SELECT jsonb_agg(
          jsonb_build_object(
            'carrierId', cs.id,
            'carrierName', cs.name,
            'totalOrders', cs.total_orders,
            'deliveredOrders', cs.delivered_orders,
            'onTimeOrders', cs.on_time_orders,
            'successRate', 
              CASE WHEN cs.total_orders > 0
                THEN ROUND((cs.delivered_orders::DECIMAL / cs.total_orders * 100)::NUMERIC, 2)
                ELSE 0
              END,
            'onTimeRate',
              CASE WHEN cs.delivered_orders > 0
                THEN ROUND((cs.on_time_orders::DECIMAL / cs.delivered_orders * 100)::NUMERIC, 2)
                ELSE 0
              END,
            'avgCost', ROUND(COALESCE(cs.avg_cost, 0)::NUMERIC, 2)
          )
        )
        FROM carrier_stats cs
      )
    ) INTO metrics
  FROM delivery_stats ds;

  RETURN metrics;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate delivery reports
CREATE OR REPLACE FUNCTION generate_delivery_report(
  project_id_filter UUID DEFAULT NULL,
  report_type VARCHAR DEFAULT 'summary',
  start_date TIMESTAMP DEFAULT NULL,
  end_date TIMESTAMP DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  report_data JSONB;
BEGIN
  CASE report_type
    WHEN 'summary' THEN
      -- Summary report with key metrics
      SELECT jsonb_build_object(
        'reportType', 'summary',
        'generatedAt', NOW(),
        'dateRange', jsonb_build_object(
          'startDate', start_date,
          'endDate', end_date
        ),
        'projectId', project_id_filter,
        'metrics', calculate_delivery_metrics(project_id_filter, start_date, end_date),
        'recentOrders', (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', dord.id,
              'orderNumber', dord.order_number,
              'status', dord.status,
              'priority', dord.priority,
              'createdAt', dord.created_at,
              'requestedDeliveryDate', dord.requested_delivery_date,
              'actualDeliveryDate', dord.actual_delivery_date,
              'totalCost', dord.total_delivery_cost_inr,
              'carrierName', c.name
            )
          )
          FROM delivery_orders dord
          LEFT JOIN carriers c ON dord.carrier_id = c.id
          WHERE (project_id_filter IS NULL OR dord.project_id = project_id_filter)
            AND (start_date IS NULL OR dord.created_at >= start_date)
            AND (end_date IS NULL OR dord.created_at <= end_date)
          ORDER BY dord.created_at DESC
          LIMIT 10
        )
      ) INTO report_data;

    WHEN 'detailed' THEN
      -- Detailed report with all orders and items
      SELECT jsonb_build_object(
        'reportType', 'detailed',
        'generatedAt', NOW(),
        'dateRange', jsonb_build_object(
          'startDate', start_date,
          'endDate', end_date
        ),
        'projectId', project_id_filter,
        'orders', (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', dord.id,
              'orderNumber', dord.order_number,
              'status', dord.status,
              'priority', dord.priority,
              'createdAt', dord.created_at,
              'deliveryAddress', jsonb_build_object(
                'companyName', da.company_name,
                'city', da.city,
                'country', da.country
              ),
              'carrier', CASE WHEN c.id IS NOT NULL 
                THEN jsonb_build_object('name', c.name, 'code', c.code)
                ELSE NULL
              END,
              'costs', jsonb_build_object(
                'delivery', dord.delivery_cost_inr,
                'insurance', dord.insurance_cost_inr,
                'handling', dord.handling_cost_inr,
                'total', dord.total_delivery_cost_inr
              ),
              'items', (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'partNumber', bi.part_number,
                    'description', bi.description,
                    'deliveryQuantity', di.delivery_quantity,
                    'unitValue', di.unit_value_inr,
                    'totalValue', di.total_value_inr
                  )
                )
                FROM delivery_items di
                JOIN bom_items bi ON di.bom_item_id = bi.id
                WHERE di.delivery_order_id = dord.id
              )
            )
          )
          FROM delivery_orders dord
          LEFT JOIN delivery_addresses da ON dord.delivery_address_id = da.id
          LEFT JOIN carriers c ON dord.carrier_id = c.id
          WHERE (project_id_filter IS NULL OR dord.project_id = project_id_filter)
            AND (start_date IS NULL OR dord.created_at >= start_date)
            AND (end_date IS NULL OR dord.created_at <= end_date)
          ORDER BY dord.created_at DESC
        )
      ) INTO report_data;

    ELSE
      RAISE EXCEPTION 'Invalid report type: %. Supported types: summary, detailed', report_type;
  END CASE;

  RETURN report_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION create_delivery_order_transaction(JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION update_delivery_order_status_bulk(UUID[], delivery_status, VARCHAR, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_delivery_metrics(UUID, TIMESTAMP, TIMESTAMP) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_delivery_report(UUID, VARCHAR, TIMESTAMP, TIMESTAMP) TO authenticated;

-- Add function comments
COMMENT ON FUNCTION create_delivery_order_transaction IS 'Creates a delivery order with items in a single transaction with full validation';
COMMENT ON FUNCTION update_delivery_order_status_bulk IS 'Updates multiple delivery orders status with tracking events';
COMMENT ON FUNCTION calculate_delivery_metrics IS 'Calculates comprehensive delivery performance metrics';
COMMENT ON FUNCTION generate_delivery_report IS 'Generates detailed delivery reports in JSON format';