'use client';

import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { MethodBadge } from './MethodBadge';
import type { ApiSpec } from '@/lib/docs/api-spec-types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  spec: ApiSpec;
}

export function SearchModal({ isOpen, onClose, spec }: SearchModalProps) {
  const router = useRouter();

  const allGroups = spec.groups.map((group) => ({
    group,
    endpoints: group.endpoints,
  }));

  const handleSelect = (section: string, endpoint: string) => {
    router.push(`/developer/api-reference/${section}/${endpoint}`);
    onClose();
  };

  return (
    <CommandDialog open={isOpen} onOpenChange={onClose}>
      <CommandInput placeholder="Search endpoints..." />
      <CommandList>
        <CommandEmpty>No endpoints found.</CommandEmpty>
        {allGroups.map(({ group, endpoints }) => (
          <CommandGroup key={group.id} heading={group.label}>
            {endpoints.map((ep) => (
              <CommandItem
                key={ep.id}
                value={`${group.label} ${ep.summary} ${ep.path}`}
                onSelect={() => handleSelect(group.id, ep.id)}
                className="flex items-center gap-3 cursor-pointer"
              >
                <MethodBadge method={ep.method} size="sm" />
                <span className="font-mono text-xs text-muted-foreground">{ep.path}</span>
                <span className="text-sm text-foreground truncate">{ep.summary}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
