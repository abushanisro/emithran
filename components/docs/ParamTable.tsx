import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Parameter, SchemaProperty } from '@/lib/docs/api-spec-types';

interface ParamTableProps {
  parameters: Parameter[];
  title: string;
}

function TypeBadge({ type }: { type: string }) {
  const t = type.toLowerCase();
  let cls = 'bg-muted text-muted-foreground border-border';
  if (t === 'string') cls = 'bg-blue-500/15 text-blue-400 border-blue-500/30';
  else if (t === 'integer' || t === 'number' || t === 'float') cls = 'bg-green-500/15 text-green-400 border-green-500/30';
  else if (t === 'boolean') cls = 'bg-purple-500/15 text-purple-400 border-purple-500/30';
  else if (t === 'object') cls = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  else if (t === 'array') cls = 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
  else if (t === 'uuid' || t === 'date' || t === 'datetime') cls = 'bg-orange-500/15 text-orange-400 border-orange-500/30';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-mono ${cls}`}>
      {type}
    </span>
  );
}

const MAX_DEPTH = 4;

function ParamRow({
  param,
  depth = 0,
  keyPrefix = '',
}: {
  param: Parameter & { schema?: SchemaProperty };
  depth?: number;
  keyPrefix?: string;
}) {
  const hasChildren = depth < MAX_DEPTH && param.schema?.properties && param.schema.properties.length > 0;
  const indent = depth * 16;

  return (
    <>
      <TableRow className="hover:bg-muted/20">
        <TableCell className="font-mono text-xs text-foreground font-medium py-3">
          <div className="flex items-center" style={{ paddingLeft: `${indent}px` }}>
            {depth > 0 && (
              <span className="mr-2 text-border/60 select-none">└</span>
            )}
            <span>{param.name}</span>
            {param.default !== undefined && (
              <span className="ml-1.5 text-muted-foreground font-sans font-normal text-[10px]">
                = {String(param.default)}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="py-3">
          <div className="flex items-center gap-1 flex-wrap">
            <TypeBadge type={param.type} />
            {param.format && (
              <span className="text-[10px] text-muted-foreground font-mono">({param.format})</span>
            )}
          </div>
        </TableCell>
        <TableCell className="py-3">
          {param.required ? (
            <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-400 bg-amber-500/10">
              required
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">optional</span>
          )}
        </TableCell>
        <TableCell className="py-3 text-xs text-muted-foreground leading-relaxed">
          {param.description}
          {param.enum && (
            <div className="mt-1 flex flex-wrap gap-1">
              {param.enum.map((v) => (
                <code key={v} className="text-[10px] bg-muted/50 px-1 py-0.5 rounded text-foreground/70">
                  {v}
                </code>
              ))}
            </div>
          )}
          {param.example !== undefined && (
            <div className="mt-1 text-[10px] text-muted-foreground/60">
              Example: <code className="text-foreground/60">{String(param.example)}</code>
            </div>
          )}
        </TableCell>
      </TableRow>
      {hasChildren && param.schema?.properties?.map((child) => (
        <ParamRow
          key={`${keyPrefix}${param.name}.${child.name}`}
          param={{
            name: child.name,
            in: param.in,
            type: child.type,
            required: child.required ?? false,
            description: child.description ?? '',
            ...(child.example !== undefined ? { example: child.example } : {}),
            ...(child.enum ? { enum: child.enum } : {}),
            ...(child.format ? { format: child.format } : {}),
            ...(child.default !== undefined ? { default: child.default } : {}),
            schema: child,
          }}
          depth={depth + 1}
          keyPrefix={`${keyPrefix}${param.name}.`}
        />
      ))}
    </>
  );
}

export function ParamTable({ parameters, title }: ParamTableProps) {
  if (parameters.length === 0) return null;

  return (
    <div className="mb-6">
      <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        {title}
      </h4>
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-xs font-semibold text-muted-foreground w-[180px]">Name</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground w-[120px]">Type</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground w-[80px]">Required</TableHead>
              <TableHead className="text-xs font-semibold text-muted-foreground">Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {parameters.map((param) => (
              <ParamRow key={param.name} param={param} depth={0} keyPrefix="" />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
