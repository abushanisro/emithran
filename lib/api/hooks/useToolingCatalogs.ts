/** React Query hooks for the tooling catalogs: reference data, the same for every organization, so cached for the session. */

import { useQuery } from "@tanstack/react-query";

import { toolingCatalogsApi } from "../tooling-catalogs";

export function useToolingCatalogDomains(enabled = true) {
  return useQuery({
    queryKey: ["tooling-catalogs"],
    queryFn: () => toolingCatalogsApi.domains(),
    staleTime: Infinity,
    enabled,
  });
}

export function useToolingCatalog(domain: string | undefined) {
  return useQuery({
    queryKey: ["tooling-catalogs", domain],
    queryFn: () => toolingCatalogsApi.get(domain!),
    staleTime: Infinity,
    enabled: !!domain,
  });
}
