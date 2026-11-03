/**
 * React hooks for Supplier Evaluation API
 *
 * Provides hooks for managing supplier evaluations with full CRUD operations
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/providers/auth';
import {
  getSupplierEvaluations,
  type SupplierEvaluationQuery,
} from '../supplier-evaluation';

const QUERY_KEY = 'supplier-evaluations';

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Hook to fetch all supplier evaluations with optional filtering
 */
export function useSupplierEvaluations(query?: SupplierEvaluationQuery) {
  const { user, loading: authLoading } = useAuth();

  return useQuery({
    queryKey: [QUERY_KEY, query],
    queryFn: () => getSupplierEvaluations(query),
    enabled: !authLoading && !!user,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

