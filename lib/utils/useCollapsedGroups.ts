import { useState } from 'react';

// Shared collapse-state logic for a page with one or more collapsible named
// groups (HR Rates' category rows, Process page's category sub-headers).
// Pure state + toggle helpers — each page still owns its own row markup,
// since HR Rates renders table rows and Process renders plain divs.
export function useCollapsedGroups(groupNames: readonly string[]) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const isCollapsed = (name: string) => collapsed.has(name);
  const allCollapsed = groupNames.length > 0 && groupNames.every((n) => collapsed.has(n));
  const collapseAll = () => setCollapsed(new Set(groupNames));
  const expandAll = () => setCollapsed(new Set());

  return { isCollapsed, toggle, allCollapsed, collapseAll, expandAll };
}
