import { useState, useMemo, useEffect } from 'react';
// Fix TS6133: removed unused imports Info, Network
import { Plus, Edit2, Trash2, ZoomIn, ZoomOut, Maximize2, AlertTriangle, CheckCircle, XCircle, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
// Fix TS6133: removed unused import Progress
import { toast } from 'sonner';
import { BOMItemType } from '@/lib/types/bom.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BOMItem {
  id: string;
  name: string;
  partNumber?: string;
  itemType: BOMItemType;
  quantity: number;
  unit?: string;
  material?: string;
  children?: BOMItem[];
}

interface BOMTreeViewProps {
  items: BOMItem[];
  projectName?: string;
  projectId?: string;
  onAddItem: (parentId: string | null, type: BOMItemType) => void;
  onEditItem: (item: BOMItem) => void;
  onDeleteItem: (id: string) => void;
}

type ValidationIssueType  = 'circular' | 'orphaned' | 'missing_quantity' | 'invalid_hierarchy' | 'duplicate_parts' | 'missing_data';
type ValidationSeverity   = 'low' | 'medium' | 'high' | 'critical';

interface ValidationIssue {
  type: ValidationIssueType;
  severity: ValidationSeverity;
  title: string;
  description: string;
  itemId?: string;
  suggestion: string;
  affectedItems?: string[];
}

interface BOMValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  summary: {
    totalItems: number;
    assemblies: number;
    subAssemblies: number;
    childParts: number;
    orphanedItems: number;
    maxDepth: number;
    estimatedComplexity: 'low' | 'medium' | 'high';
  };
}

interface NodePosition {
  x: number;
  y: number;
  level: number;
}

interface TreeNode extends BOMItem {
  position: NodePosition;
  isExpanded: boolean;
  parentPos?: NodePosition;
}

// Fix TS18048 + TS2322: use a concrete typed object instead of Record<string, number>
interface ItemCounts {
  assemblies: number;
  subAssemblies: number;
  childParts: number;
}

interface CalcStatsResult {
  counts: ItemCounts;
  maxDepth: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function generateCurvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

function validateBOMStructure(items: BOMItem[]): BOMValidationResult {
  const issues: ValidationIssue[]           = [];
  const itemMap                             = new Map<string, BOMItem>();
  const visited                             = new Set<string>();
  const childToParent                       = new Map<string, string>();

  const buildMaps = (itemList: BOMItem[], parentId?: string) => {
    itemList.forEach(item => {
      itemMap.set(item.id, item);
      if (parentId) childToParent.set(item.id, parentId);
      if (item.children) buildMaps(item.children, item.id);
    });
  };
  buildMaps(items);

  // Circular dependency check
  const detectCircular = (itemId: string, path: Set<string>): void => {
    if (path.has(itemId)) {
      issues.push({
        type: 'circular',
        severity: 'critical',
        title: 'Circular Dependency Detected',
        description: 'Item creates a circular reference in the BOM structure',
        itemId,
        suggestion: 'Remove the circular reference by restructuring the hierarchy',
        affectedItems: Array.from(path),
      });
      return;
    }
    if (visited.has(itemId)) return;
    visited.add(itemId);
    path.add(itemId);
    const item = itemMap.get(itemId);
    item?.children?.forEach(child => detectCircular(child.id, new Set(path)));
    path.delete(itemId);
  };
  items.forEach(item => detectCircular(item.id, new Set()));

  // Orphaned items
  const orphanedItems: string[] = [];
  const findOrphaned = (itemList: BOMItem[], isTopLevel = true) => {
    itemList.forEach(item => {
      if (!isTopLevel && (item.itemType === 'sub_assembly' || item.itemType === 'child_part')) {
        if (!childToParent.has(item.id)) orphanedItems.push(item.id);
      }
      if (item.children) findOrphaned(item.children, false);
    });
  };
  findOrphaned(items);

  if (orphanedItems.length > 0) {
    issues.push({
      type: 'orphaned',
      severity: 'high',
      title: 'Orphaned BOM Items',
      description: `${orphanedItems.length} items are not properly connected to the BOM hierarchy`,
      suggestion: 'Ensure all sub-assemblies and parts have proper parent assemblies',
      affectedItems: orphanedItems,
    });
  }

  // Missing data / duplicate part numbers
  const missingDataItems: string[]                    = [];
  const duplicatePartNumbers                          = new Map<string, string[]>();

  const validateItemData = (itemList: BOMItem[]) => {
    itemList.forEach(item => {
      if (!item.quantity || item.quantity <= 0) missingDataItems.push(item.id);

      if (item.partNumber) {
        if (!duplicatePartNumbers.has(item.partNumber)) {
          duplicatePartNumbers.set(item.partNumber, []);
        }
        duplicatePartNumbers.get(item.partNumber)!.push(item.id);
      }

      if (item.children) validateItemData(item.children);
    });
  };
  validateItemData(items);

  if (missingDataItems.length > 0) {
    issues.push({
      type: 'missing_quantity',
      severity: 'medium',
      title: 'Missing or Invalid Quantities',
      description: `${missingDataItems.length} items have missing or invalid quantity values`,
      suggestion: 'Update all items to have valid quantities greater than 0',
      affectedItems: missingDataItems,
    });
  }

  Array.from(duplicatePartNumbers.entries())
    .filter(([, ids]) => ids.length > 1)
    .forEach(([partNumber, ids]) => {
      issues.push({
        type: 'duplicate_parts',
        severity: 'medium',
        title: 'Duplicate Part Numbers',
        description: `Part number "${partNumber}" is used by multiple items`,
        suggestion: 'Ensure each part has a unique part number or use revision numbers',
        affectedItems: ids,
      });
    });

  // ✅ Fix TS18048 + TS2322: return CalcStatsResult with typed ItemCounts (not Record<string,number>)
  const calculateStats = (itemList: BOMItem[], depth = 0): CalcStatsResult => {
    let assemblies = 0, subAssemblies = 0, childParts = 0, maxDepth = depth;

    itemList.forEach(item => {
      if (item.itemType === 'assembly')     assemblies++;
      else if (item.itemType === 'sub_assembly') subAssemblies++;
      else if (item.itemType === 'child_part')   childParts++;

      if (item.children && item.children.length > 0) {
        const childStats = calculateStats(item.children, depth + 1);
        // ✅ All fields are now typed as `number` — no more TS18048
        assemblies    += childStats.counts.assemblies;
        subAssemblies += childStats.counts.subAssemblies;
        childParts    += childStats.counts.childParts;
        maxDepth       = Math.max(maxDepth, childStats.maxDepth);
      }
    });

    return { counts: { assemblies, subAssemblies, childParts }, maxDepth };
  };

  const stats      = calculateStats(items);
  const totalItems = stats.counts.assemblies + stats.counts.subAssemblies + stats.counts.childParts;

  return {
    isValid: issues.length === 0,
    issues,
    summary: {
      totalItems,
      // fix TS2322: all fields are number (not number | undefined)
      assemblies:          stats.counts.assemblies,
      subAssemblies:       stats.counts.subAssemblies,
      childParts:          stats.counts.childParts,
      orphanedItems:       orphanedItems.length,
      maxDepth:            stats.maxDepth,
      estimatedComplexity: totalItems > 50 ? 'high' : totalItems > 20 ? 'medium' : 'low',
    },
  };
}

function countDescendants(item: BOMItem, expandedNodes: Set<string>): number {
  if (!item.children || item.children.length === 0 || !expandedNodes.has(item.id)) return 1;
  return item.children.reduce((sum, child) => sum + countDescendants(child, expandedNodes), 0);
}

function calculateHierarchicalPositions(
  items: BOMItem[],
  expandedNodes: Set<string>,
  startY = 0,
  level  = 1,
  parentPos?: NodePosition,
): { nodes: TreeNode[]; totalHeight: number } {
  const nodes: TreeNode[] = [];
  const levelSpacing      = 280;
  const verticalSpacing   = 110;
  let currentY            = startY;

  items.forEach(item => {
    const isExpanded      = expandedNodes.has(item.id);
    const descendantCount = countDescendants(item, expandedNodes);
    const nodeHeight      = Math.max(descendantCount * verticalSpacing, verticalSpacing);
    const nodeY           = currentY + nodeHeight / 2;
    const nodeX           = level * levelSpacing;

    const position: NodePosition = { x: nodeX, y: nodeY, level };
    nodes.push({ ...item, position, isExpanded, parentPos });

    if (isExpanded && item.children && item.children.length > 0) {
      const childResult = calculateHierarchicalPositions(item.children, expandedNodes, currentY, level + 1, position);
      nodes.push(...childResult.nodes);
    }

    currentY += nodeHeight;
  });

  return { nodes, totalHeight: currentY - startY };
}

// ---------------------------------------------------------------------------
// HierarchicalNode
// ---------------------------------------------------------------------------

function HierarchicalNode({
  node,
  onToggle,
  onEdit,
  onDelete,
  onAdd,
}: {
  node: TreeNode;
  onToggle: (id: string) => void;
  onEdit:   (item: BOMItem) => void;
  onDelete: (id: string) => void;
  onAdd:    (parentId: string, type: BOMItemType) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const hasChildren = (node.children?.length ?? 0) > 0;

  const getChildType = (): BOMItemType | null => {
    if (node.itemType === BOMItemType.ASSEMBLY)     return BOMItemType.SUB_ASSEMBLY;
    if (node.itemType === BOMItemType.SUB_ASSEMBLY) return BOMItemType.CHILD_PART;
    return null;
  };

  const getTypeLabel = (): string => {
    switch (node.itemType) {
      case BOMItemType.ASSEMBLY:     return 'Assembly';
      case BOMItemType.SUB_ASSEMBLY: return 'Sub-assembly';
      case BOMItemType.CHILD_PART:   return 'Part';
      default:                       return '';
    }
  };

  const getTypeColors = () => {
    switch (node.itemType) {
      case BOMItemType.ASSEMBLY:
        return { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', hoverBorder: 'hover:border-emerald-500/50', text: 'text-emerald-700', hoverBg: 'bg-emerald-500/15', hoverBorderStrong: 'border-emerald-500/60' };
      case BOMItemType.SUB_ASSEMBLY:
        return { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    hoverBorder: 'hover:border-blue-500/50',    text: 'text-blue-700',    hoverBg: 'bg-blue-500/15',    hoverBorderStrong: 'border-blue-500/60'    };
      case BOMItemType.CHILD_PART:
        return { bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  hoverBorder: 'hover:border-orange-500/50',  text: 'text-orange-700',  hoverBg: 'bg-orange-500/15',  hoverBorderStrong: 'border-orange-500/60'  };
      default:
        return { bg: 'bg-card',           border: 'border-border',          hoverBorder: 'hover:border-foreground/30',  text: 'text-muted-foreground', hoverBg: 'bg-card', hoverBorderStrong: 'border-primary/50' };
    }
  };

  const childType  = getChildType();
  const typeColors = getTypeColors();
  const pos        = node.position;

  return (
    <>
      {node.parentPos && (
        <motion.path
          d={generateCurvedPath(node.parentPos.x, node.parentPos.y, pos.x, pos.y)}
          stroke="hsl(var(--border))"
          strokeWidth="2"
          fill="none"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 0.3 }}
          exit={{ pathLength: 0, opacity: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      )}

      <motion.g
        initial={{ opacity: 0, x: pos.x - 50 }}
        animate={{ opacity: 1, x: pos.x, y: pos.y }}
        exit={{ opacity: 0, x: pos.x - 50 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <foreignObject x={-80} y={-40} width="160" height="80">
          <div
            className="flex flex-col items-center justify-center h-full"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            <div
              className={cn(
                'relative rounded-md p-2.5 w-full border transition-all duration-200 cursor-pointer',
                typeColors.bg,
                isHovered
                  ? cn('shadow-lg scale-105', typeColors.hoverBg, typeColors.hoverBorderStrong)
                  : cn('shadow-sm', typeColors.border, typeColors.hoverBorder),
              )}
              onClick={() => hasChildren && onToggle(node.id)}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <div className={cn('text-[9px] uppercase tracking-wider font-semibold', typeColors.text)}>
                    {getTypeLabel()}
                  </div>
                  {hasChildren && (
                    <motion.div
                      animate={{ rotate: node.isExpanded ? 90 : 0 }}
                      transition={{ duration: 0.2 }}
                      className={typeColors.text}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <path d="M4 2 L8 6 L4 10" stroke="currentColor" strokeWidth="2" fill="none" />
                      </svg>
                    </motion.div>
                  )}
                </div>

                <h4 className="font-semibold text-foreground text-xs leading-tight line-clamp-1">
                  {node.name}
                </h4>

                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  {node.partNumber && <span className="font-medium">{node.partNumber}</span>}
                  <span>•</span>
                  <span>{node.quantity} {node.unit ?? 'pcs'}</span>
                </div>
              </div>

              <AnimatePresence>
                {isHovered && (
                  <motion.div
                    className="absolute -bottom-9 left-1/2 -translate-x-1/2 flex gap-0.5 bg-background rounded border border-border shadow-lg p-0.5 z-50"
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    transition={{ duration: 0.15 }}
                    onClick={e => e.stopPropagation()}
                  >
                    {childType && (
                      <Button variant="ghost" size="icon" className="h-6 w-6"
                        onClick={e => { e.stopPropagation(); onAdd(node.id, childType); }}>
                        <Plus className="h-3 w-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6"
                      onClick={e => { e.stopPropagation(); onEdit(node); }}>
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive"
                      onClick={e => { e.stopPropagation(); onDelete(node.id); }}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </foreignObject>
      </motion.g>
    </>
  );
}

// ---------------------------------------------------------------------------
// BOMTreeView
// ---------------------------------------------------------------------------

export function BOMTreeView({ items, projectName, projectId, onAddItem, onEditItem, onDeleteItem }: BOMTreeViewProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    const expanded = new Set(items.map(i => i.id));
    expanded.add('project-root');
    return expanded;
  });
  const [zoom,             setZoom]             = useState(0.8);
  const [isRootHovered,    setIsRootHovered]    = useState(false);
  const [showValidation,   setShowValidation]   = useState(true);
  const [validationResult, setValidationResult] = useState<BOMValidationResult | null>(null);

  useEffect(() => {
    if (items.length === 0) { setValidationResult(null); return; }
    try {
      const result = validateBOMStructure(items);
      setValidationResult(result);

      const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
      if (criticalCount > 0) {
        toast.error('BOM Structure Issues', {
          description: `${criticalCount} critical issues detected`,
          duration: 8_000,
          action: { label: 'View Details', onClick: () => setShowValidation(true) },
        });
      }
    } catch (error) {
      console.error('BOM validation error:', error);
      toast.error('Failed to validate BOM structure');
    }
  }, [items]);

  const toggleNode = (id: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const { treeNodes, svgDimensions } = useMemo(() => {
    if (items.length === 0 || !expandedNodes.has('project-root')) {
      return { treeNodes: [], svgDimensions: { width: 800, height: 500 } };
    }

    const rootPos: NodePosition = { x: 150, y: 50, level: 0 };
    const result = calculateHierarchicalPositions(items, expandedNodes, 50, 1, rootPos);

    const maxX = Math.max(...result.nodes.map(n => n.position.x), rootPos.x) + 200;
    const maxY = Math.max(result.totalHeight + 100, 500);

    return { treeNodes: result.nodes, svgDimensions: { width: maxX, height: maxY } };
  }, [items, expandedNodes]);

  const hasItems      = items.length > 0;
  const criticalIssues = validationResult?.issues.filter(i => i.severity === 'critical') ?? [];
  const highIssues     = validationResult?.issues.filter(i => i.severity === 'high')     ?? [];

  return (
    <div className="space-y-4">

      {/* ── Full validation panel ─────────────────────────────────────────── */}
      {validationResult && showValidation && (
        <div className="bg-card border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-lg">BOM Structure Analysis</h3>
                <p className="text-sm text-muted-foreground">Structure validation and integrity checks</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowValidation(false)}>
              <XCircle className="h-4 w-4" />
            </Button>
          </div>

          {/* Summary statistics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Assemblies',     value: validationResult.summary.assemblies,    color: 'text-emerald-600' },
              { label: 'Sub-Assemblies', value: validationResult.summary.subAssemblies, color: 'text-blue-600'    },
              { label: 'Child Parts',    value: validationResult.summary.childParts,    color: 'text-amber-600'   },
              { label: 'Max Depth',      value: validationResult.summary.maxDepth,      color: 'text-muted-foreground' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center p-3 bg-muted/30 rounded-lg">
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>

          {/* Validation status */}
          <div className="flex items-center gap-3">
            {validationResult.isValid ? (
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">BOM Structure Valid</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                <XCircle className="h-5 w-5" />
                <span className="font-medium">{validationResult.issues.length} Issues Found</span>
              </div>
            )}
            <Badge variant={
              validationResult.summary.estimatedComplexity === 'high'   ? 'destructive' :
              validationResult.summary.estimatedComplexity === 'medium' ? 'default'     : 'secondary'
            }>
              {validationResult.summary.estimatedComplexity.toUpperCase()} Complexity
            </Badge>
          </div>

          {/* Issue list */}
          {validationResult.issues.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Validation Issues
              </h4>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {validationResult.issues.map((issue, index) => (
                  <Alert
                    key={index}
                    variant={issue.severity === 'critical' || issue.severity === 'high' ? 'destructive' : 'default'}
                    className="py-2"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    <div className="space-y-1">
                      <AlertTitle className="text-sm flex items-center gap-2">
                        {issue.title}
                        <Badge variant="outline" className="text-xs">{issue.severity.toUpperCase()}</Badge>
                      </AlertTitle>
                      <AlertDescription className="text-xs">{issue.description}</AlertDescription>
                      <p className="text-xs text-muted-foreground mt-1">Suggestion: {issue.suggestion}</p>
                      {(issue.affectedItems?.length ?? 0) > 0 && (
                        <p className="text-xs text-muted-foreground">Affected items: {issue.affectedItems!.length}</p>
                      )}
                    </div>
                  </Alert>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Collapsed summary bar ─────────────────────────────────────────── */}
      {validationResult && !showValidation && (
        <div className="flex items-center justify-between bg-muted/30 border rounded p-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {validationResult.isValid
                ? <CheckCircle  className="h-4 w-4 text-green-600" />
                : <AlertTriangle className="h-4 w-4 text-yellow-600" />}
              <span className="text-sm font-medium">
                {validationResult.summary.totalItems} items •{' '}
                {validationResult.isValid ? 'Valid Structure' : `${validationResult.issues.length} issues`}
              </span>
            </div>
            {(criticalIssues.length > 0 || highIssues.length > 0) && (
              <div className="flex items-center gap-1">
                {criticalIssues.length > 0 && <Badge variant="destructive" className="text-xs">{criticalIssues.length} Critical</Badge>}
                {highIssues.length     > 0 && <Badge variant="default"     className="text-xs">{highIssues.length} High</Badge>}
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowValidation(true)}>
            View Details
          </Button>
        </div>
      )}

      {/* ── SVG canvas ───────────────────────────────────────────────────── */}
      <div className="relative w-full h-[500px] md:h-[600px] lg:h-[700px] bg-background rounded-lg overflow-hidden border border-border">

        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-10 flex gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" title="Zoom in"   onClick={() => setZoom(z => Math.min(z + 0.1, 1.5))}>
            <ZoomIn   className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" title="Zoom out"  onClick={() => setZoom(z => Math.max(z - 0.1, 0.4))}>
            <ZoomOut  className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" title="Reset zoom" onClick={() => setZoom(0.8)}>
            <Maximize2 className="h-3 w-3" />
          </Button>
        </div>

        <div className="w-full h-full overflow-auto">
          <svg
            className="min-w-full min-h-full"
            width={svgDimensions.width  * zoom}
            height={svgDimensions.height * zoom}
            viewBox={`0 0 ${svgDimensions.width} ${svgDimensions.height}`}
            preserveAspectRatio="xMinYMin meet"
          >
            {/* Project root node */}
            <g transform="translate(150, 50)">
              <foreignObject x="-90" y="-45" width="180" height="90">
                <div
                  className="flex items-center justify-center h-full"
                  onMouseEnter={() => setIsRootHovered(true)}
                  onMouseLeave={() => setIsRootHovered(false)}
                >
                  <div
                    className={cn(
                      'relative rounded-lg p-3 w-full cursor-pointer border-2 shadow-md transition-all duration-200',
                      isRootHovered
                        ? 'bg-primary/15 border-primary/60 shadow-lg scale-105'
                        : 'bg-primary/10 border-primary/30 hover:border-primary/50',
                    )}
                    onClick={() => toggleNode('project-root')}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] text-primary font-bold uppercase tracking-wider">
                          Project Root
                        </div>
                        {hasItems && (
                          <motion.div
                            animate={{ rotate: expandedNodes.has('project-root') ? 90 : 0 }}
                            transition={{ duration: 0.2 }}
                            className="text-primary"
                          >
                            <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor">
                              <path d="M4 2 L8 6 L4 10" stroke="currentColor" strokeWidth="2" fill="none" />
                            </svg>
                          </motion.div>
                        )}
                      </div>
                      <h4 className="font-bold text-foreground text-sm leading-tight">
                        {projectName ?? 'Project'}
                      </h4>
                      {projectId && (
                        <div className="text-[10px] text-muted-foreground font-medium">
                          ID: {projectId}
                        </div>
                      )}
                    </div>

                    <AnimatePresence>
                      {isRootHovered && (
                        <motion.div
                          className="absolute -bottom-9 left-1/2 -translate-x-1/2 flex gap-0.5 bg-background rounded border border-border shadow-lg p-0.5 z-50"
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          transition={{ duration: 0.15 }}
                          onClick={e => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="Add BOM Assembly"
                            onClick={e => { e.stopPropagation(); onAddItem(null, BOMItemType.ASSEMBLY); }}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              </foreignObject>
            </g>

            {/* Child nodes */}
            <AnimatePresence>
              {treeNodes.map(node => (
                <HierarchicalNode
                  key={node.id}
                  node={node}
                  onToggle={toggleNode}
                  onEdit={onEditItem}
                  onDelete={onDeleteItem}
                  onAdd={onAddItem}
                />
              ))}
            </AnimatePresence>
          </svg>
        </div>
      </div>
    </div>
  );
}