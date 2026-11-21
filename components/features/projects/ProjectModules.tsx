'use client';

import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
  CheckCircle2,
  Clock,
} from '@/components/ui/icons';
import { cn } from '@/lib/utils';

interface ModuleCardProps {
  title: string;
  description: string;
  borderColor: string;
  status: 'active' | 'available' | 'coming-soon';
  itemCount?: number;
  imageOutside?: boolean;
  onClick?: () => void;
}

function ModuleCard({
  title,
  description,
  borderColor: _borderColor,
  status,
  itemCount: _itemCount,
  imageOutside: _imageOutside = false,
  onClick,
}: ModuleCardProps) {
  const isDisabled = status === 'coming-soon';


  return (
    <div className="flex w-full">
      <Card
        className={cn(
          'flex w-full flex-col justify-between gap-3 p-4 transition-colors',
          isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/40',
        )}
        onClick={() => {
          if (!isDisabled && onClick) {
            onClick();
          }
        }}
      >
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-foreground">{title}</CardTitle>
            {status === 'active' && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Active" />}
            {status === 'available' && <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Available" />}
            {status === 'coming-soon' && (
              <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">
                Coming Soon
              </Badge>
            )}
          </div>
          <CardDescription className="line-clamp-2 text-xs leading-snug text-muted-foreground">
            {description}
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-fit text-xs"
          disabled={isDisabled}
          onClick={(e) => {
            e.stopPropagation(); // Prevent card click when button is clicked
            if (!isDisabled && onClick) {
              onClick();
            }
          }}
        >
          {isDisabled ? 'Coming Soon' : 'Open Module'}
        </Button>
      </Card>
    </div>
  );
}

interface ProjectModulesProps {
  projectId: string;
  bomCount: number;
  firstBomId?: string;
}

export function ProjectModules({ projectId, bomCount, firstBomId: _firstBomId }: ProjectModulesProps) {
  const router = useRouter();

  const modules = [
    {
      title: 'BOM Management',
      description: 'Create and manage Bills of Materials with assembly hierarchies, technical drawings, and 3D models',
      borderColor: 'border-l-4 border-l-blue-500',
      status: bomCount > 0 ? ('active' as const) : ('available' as const),
      itemCount: bomCount,
      onClick: () => {
        // Navigate to global BOM management page with project context
        router.push(`/bom?projectId=${projectId}`);
      },
    },
    {
      title: 'Electronics',
      description: 'PCB assemblies and wire harnesses: board file extraction, BOM lines, part prices and assembly cost',
      borderColor: 'border-l-4 border-l-cyan-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/projects/${projectId}/electronics`);
      },
    },
    {
      title: 'Process Planning & Costing',
      description: 'Define manufacturing processes, material selection, and cost estimation for OEM and suppliers',
      borderColor: 'border-l-4 border-l-primary/40',
      status: 'available' as const,
      onClick: () => {
        router.push(`/projects/${projectId}/process-planning`);
      },
    },
    {
      title: 'Supplier Evaluation',
      description: 'Technical feasibility assessment, supplier shortlist management, and RFQ distribution',
      borderColor: 'border-l-4 border-l-orange-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/projects/${projectId}/supplier-evaluation`);
      },
    },
    {
      title: 'Supplier Nomination',
      description: 'Cost analysis, weighted scoring, and final supplier recommendation for nomination decisions',
      borderColor: 'border-l-4 border-l-teal-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/projects/${projectId}/supplier-nomination`);
      },
    },
    {
      title: 'Production Planning',
      description: 'Manage ISIR/FIA sample submission, PPAP lot, and batch lot production planning',
      borderColor: 'border-l-4 border-l-indigo-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/projects/${projectId}/production-planning`);
      },
    },
    {
      title: 'Quality Control',
      description: 'Manage quality inspections, testing protocols, defect tracking, and compliance documentation',
      borderColor: 'border-l-4 border-l-red-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/projects/${projectId}/quality-control`);
      },
    },
    {
      title: 'Benchmark Analysis',
      description: 'Compare BOMs across projects, identify cost drivers, and discover VAVE opportunities for optimization',
      borderColor: 'border-l-4 border-l-yellow-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/benchmarks?projectId=${projectId}`);
      },
    },
    {
      title: 'VAVE',
      description: 'Value Analysis & Value Engineering — AI-accelerated cost reduction using SCAMPER, TRIZ, and should-cost analysis',
      borderColor: 'border-l-4 border-l-primary/40',
      status: 'available' as const,
      onClick: () => {
        router.push(`/vave?sourceProjectId=${projectId}`);
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Project Modules</h2>
        <p className="text-sm text-muted-foreground">
          Select a module to manage different aspects of your manufacturing cost project
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((module) => (
          <ModuleCard key={module.title} {...module} />
        ))}
      </div>
    </div>
  );
}
