import type { MaterialPickerScope } from '@/lib/features/material-picker-query'

/** The Material Database's process choice: the selected process's materials, or every material. Two buttons, the active one pressed. */
export function MaterialScopeToggle({ processGroup, scope, onChange }: {
  processGroup: string
  scope: MaterialPickerScope
  onChange: (scope: MaterialPickerScope) => void
}) {
  const options: { value: MaterialPickerScope; label: string }[] = [
    { value: 'process', label: `${processGroup} materials` },
    { value: 'all', label: 'All processes' },
  ]
  return (
    <div role="group" aria-label="Process" className="flex shrink-0 rounded border border-border overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={scope === o.value}
          onClick={() => { onChange(o.value) }}
          className={`text-xs px-2.5 py-1.5 whitespace-nowrap transition-colors ${
            scope === o.value ? 'bg-brand-500 text-white' : 'bg-background text-muted-foreground hover:bg-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
