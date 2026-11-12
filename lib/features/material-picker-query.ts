import type { QueryRawMaterialsParams } from '@/lib/api/hooks/useRawMaterials'

/** "process": the selected process's materials (process_material_groups, migration 879). "all": the whole catalog. */
export type MaterialPickerScope = 'process' | 'all'

/** The raw-materials query of the Material Database dialog. Without a selected process it is always the whole catalog. */
export function materialPickerQuery(o: {
  processGroup: string | null | undefined
  scope: MaterialPickerScope
  search?: string
  materialGroup?: string
  materialClass?: string
}): QueryRawMaterialsParams {
  return {
    limit: 1000,
    ...(o.scope === 'process' && o.processGroup ? { processGroup: o.processGroup } : {}),
    ...(o.search ? { search: o.search } : {}),
    ...(o.materialGroup ? { materialGroup: o.materialGroup } : {}),
    ...(o.materialClass ? { materialClass: o.materialClass } : {}),
  }
}
