import { useQuery } from '@tanstack/react-query';

import { lhrApi } from '../lhr';


// Only how many LHR records exist (the dashboard's setup checklist), so the
// whole table is never downloaded just to be counted.
export const useLHRCount = () => useQuery({
    queryKey: ['lhr', 'count'],
    queryFn: () => lhrApi.getCount(),
    retry: false,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    throwOnError: false,
  });
