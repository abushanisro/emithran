'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  AlertCircle,
} from 'lucide-react';

interface ModuleCardProps {
  title: string;
  description: string;
  borderColor: string;
  status: 'active' | 'available' | 'coming-soon';
  itemCount?: number;
  onClick?: () => void;
}

function ModuleCard({
  title,
  description,
  borderColor,
  status,
  itemCount,
  onClick,
}: ModuleCardProps) {
  const isDisabled = status === 'coming-soon';

  return (
    <Card
      className={`transition-all duration-200 ${
        isDisabled
          ? 'opacity-60 cursor-not-allowed'
          : 'hover:shadow-lg hover:-translate-y-1'
      } ${borderColor}`}
    >
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          {status === 'active' && itemCount !== undefined && (
            <Badge variant="secondary" className="font-semibold">
              {itemCount} {itemCount === 1 ? 'Item' : 'Items'}
            </Badge>
          )}
          {status === 'coming-soon' && (
            <Badge variant="outline" className="text-muted-foreground">
              Coming Soon
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <CardTitle className="text-xl mb-2 flex items-center gap-2">
            {title}
            {status === 'active' && <CheckCircle2 className="h-5 w-5 text-green-600" />}
            {status === 'available' && <Clock className="h-5 w-5 text-blue-600" />}
            {status === 'coming-soon' && <AlertCircle className="h-5 w-5 text-muted-foreground" />}
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">{description}</CardDescription>
        </div>

        <Button
          className="w-full gap-2 group"
          variant={isDisabled ? 'outline' : 'default'}
          disabled={isDisabled}
          onClick={!isDisabled ? onClick : undefined}
        >
          {isDisabled ? (
            'Coming Soon'
          ) : (
            <>
              Open Module
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

interface ProjectModulesProps {
  projectId: string;
  bomCount: number;
  firstBomId?: string;
}

export function ProjectModules({ projectId, bomCount, firstBomId }: ProjectModulesProps) {
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
      title: 'Process Planning & Costing',
      description: 'Define manufacturing processes, material selection, and cost estimation for OEM and suppliers',
      borderColor: 'border-l-4 border-l-purple-500',
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
      title: 'Delivery',
      description: 'Coordinate packing and logistics for efficient delivery management',
      borderColor: 'border-l-4 border-l-green-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/projects/${projectId}/delivery`);
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Project Modules</h2>
        <p className="text-muted-foreground">
          Select a module to manage different aspects of your manufacturing cost project
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {modules.map((module) => (
          <ModuleCard key={module.title} {...module} />
        ))}
      </div>
    </div>
  );
}
