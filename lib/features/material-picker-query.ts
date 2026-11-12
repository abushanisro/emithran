import type { QueryRawMaterialsParams } from '@/lib/api/hooks/useRawMaterials'

/** The group dropdown's "<process> materials" choice: the selected process's linked material groups (migration 879). */
export const PROCESS_MATERIALS = '__process__'

/** Where the group dropdown starts: on the selected process's materials, or on All Groups ('') when no process is selected. */
export function initialMaterialGroup(processGroup: string | null | undefined): string {
  return processGroup ? PROCESS_MATERIALS : ''
}

/** The Material Database's raw-materials query for its group dropdown value ('' = All Groups), class filter and search. */
export function materialPickerQuery(o: {
  processGroup: string | null | undefined
  group: string
  materialClass?: string
  search?: string
}): QueryRawMaterialsParams {
  const processMaterials = o.group === PROCESS_MATERIALS && !!o.processGroup
  return {
    limit: 1000,
    ...(processMaterials && o.processGroup ? { processGroup: o.processGroup } : {}),
    ...(o.group && o.group !== PROCESS_MATERIALS ? { materialGroup: o.group } : {}),
    ...(o.materialClass ? { materialClass: o.materialClass } : {}),
    ...(o.search ? { search: o.search } : {}),
  }
}
