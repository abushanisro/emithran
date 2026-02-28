-- =====================================================
-- Delivery Module Transaction Functions (Simplified)
-- Basic stored procedures for delivery operations
-- NOTE: Run this AFTER the main delivery schema migration
-- =====================================================

-- Function to bulk update delivery order status with tracking
CREATE OR REPLACE FUNCTION update_delivery_order_status_bulk(
  order_ids UUID[],
  new_status VARCHAR,
  tracking_event_type VARCHAR DEFAULT NULL,
  tracking_description TEXT DEFAULT NULL,
  updated_by_user VARCHAR DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER := 0;
  order_id UUID;
  old_status VARCHAR;
BEGIN
  -- Validate status transition
  IF new_status NOT IN ('draft', 'pending_approval', 'approved', 'in_transit', 'out_for_delivery', 'delivered', 'failed_delivery', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid delivery status: %', new_status;
  END IF;

  -- Update each order
  FOREACH order_id IN ARRAY order_ids
  LOOP
    -- Get current status
    SELECT status::VARCHAR INTO old_status
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
      status = new_status::delivery_status,
      updated_at = NOW(),
      actual_delivery_date = CASE 
        WHEN new_status = 'delivered' THEN NOW()::DATE
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
        internal_notes
      ) VALUES (
        order_id,
        tracking_event_type,
        COALESCE(tracking_description, 'Status changed from ' || old_status || ' to ' || new_status),
        NOW(),
        'Bulk status update by user ' || COALESCE(updated_by_user, 'system')
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
BEGIN
  -- Build base query conditions
  WITH delivery_stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE dord.status = 'delivered') as delivered,
      COUNT(*) FILTER (
        WHERE dord.status = 'delivered' 
        AND dord.actual_delivery_date <= dord.requested_delivery_date
      ) as on_time,
      AVG(dord.total_delivery_cost_inr) as avg_cost,
      SUM(dord.total_delivery_cost_inr) as total_cost,
      AVG(
        CASE 
          WHEN dord.status = 'delivered' AND dord.actual_delivery_date IS NOT NULL AND dord.requested_delivery_date IS NOT NULL
          THEN EXTRACT(DAY FROM (dord.actual_delivery_date::timestamp - dord.requested_delivery_date::timestamp))
          ELSE NULL
        END
      ) as avg_delay
    FROM delivery_orders dord
    WHERE 1=1
      AND (project_id_filter IS NULL OR dord.project_id = project_id_filter)
      AND (start_date IS NULL OR dord.created_at >= start_date)
      AND (end_date IS NULL OR dord.created_at <= end_date)
      AND dord.status != 'cancelled'
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

-- Grant execute permissions to authenticated users
-- Note: Adjust permissions based on your auth system
GRANT EXECUTE ON FUNCTION update_delivery_order_status_bulk(UUID[], VARCHAR, VARCHAR, TEXT, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_delivery_metrics(UUID, TIMESTAMP, TIMESTAMP) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_delivery_report(UUID, VARCHAR, TIMESTAMP, TIMESTAMP) TO authenticated;

-- Add function comments
COMMENT ON FUNCTION update_delivery_order_status_bulk IS 'Updates multiple delivery orders status with tracking events';
COMMENT ON FUNCTION calculate_delivery_metrics IS 'Calculates comprehensive delivery performance metrics';
COMMENT ON FUNCTION generate_delivery_report IS 'Generates detailed delivery reports in JSON format';