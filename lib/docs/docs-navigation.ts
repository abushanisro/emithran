import type { ApiSpec, ResourceGroup, Endpoint } from './api-spec-types';

export interface SidebarEndpointNode {
  endpoint: Endpoint;
  isActive: boolean;
  href: string;
}

export interface SidebarGroupNode {
  group: ResourceGroup;
  isActive: boolean;
  endpoints: SidebarEndpointNode[];
}

export function getFirstEndpoint(spec: ApiSpec): { section: string; endpoint: string } | null {
  const firstGroup = spec.groups[0];
  if (!firstGroup) return null;
  const firstEndpoint = firstGroup.endpoints[0];
  if (!firstEndpoint) return null;
  return { section: firstGroup.id, endpoint: firstEndpoint.id };
}

export function getSectionBySlug(spec: ApiSpec, section: string): ResourceGroup | undefined {
  return spec.groups.find((g) => g.id === section);
}

export function getEndpointBySlug(
  spec: ApiSpec,
  section: string,
  endpoint: string,
): Endpoint | undefined {
  const group = getSectionBySlug(spec, section);
  return group?.endpoints.find((e) => e.id === endpoint);
}

export function buildSidebarTree(
  spec: ApiSpec,
  activeSection: string,
  activeEndpoint: string,
): SidebarGroupNode[] {
  return spec.groups.map((group) => ({
    group,
    isActive: group.id === activeSection,
    endpoints: group.endpoints.map((ep) => ({
      endpoint: ep,
      isActive: group.id === activeSection && ep.id === activeEndpoint,
      href: `/developer/api-reference/${group.id}/${ep.id}`,
    })),
  }));
}

export function getAllEndpointSlugs(
  spec: ApiSpec,
): { section: string; endpoint: string }[] {
  return spec.groups.flatMap((group) =>
    group.endpoints.map((ep) => ({ section: group.id, endpoint: ep.id })),
  );
}

export function searchEndpoints(
  spec: ApiSpec,
  query: string,
): { group: ResourceGroup; endpoint: Endpoint }[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const results: { group: ResourceGroup; endpoint: Endpoint }[] = [];
  for (const group of spec.groups) {
    for (const ep of group.endpoints) {
      if (
        ep.summary.toLowerCase().includes(q) ||
        ep.path.toLowerCase().includes(q) ||
        ep.description.toLowerCase().includes(q) ||
        group.label.toLowerCase().includes(q)
      ) {
        results.push({ group, endpoint: ep });
      }
    }
  }
  return results;
}
