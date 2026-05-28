'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GlareCard } from '@/components/ui/glare-card';
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


  // Get module image based on title
  const getModuleImage = (title: string) => {
    switch (title) {
      case 'BOM Management':
        return 'https://cdn.sanity.io/images/fdrwu6gi/production/664383895bf3dedc7e57d62eeaae2fd994c6c591-1600x1600.png?w=1200&fm=webp';
      case 'Process Planning & Costing':
        return 'https://static.vecteezy.com/system/resources/thumbnails/070/672/980/small/businessman-interacting-with-digital-workflow-diagram-representing-business-processes-optimization-and-strategic-planning-on-a-touchscreen-interface-photo.jpeg';
      case 'Supplier Evaluation':
        return 'https://barkersprocurement.com/wp-content/uploads/2023/06/Why-Supplier-Evaluation-is-Crucial-To-Your-Business-1110x630.png';
      case 'Supplier Nomination':
        return 'https://thumbs.dreamstime.com/b/hands-typing-keyboard-abstract-words-concepts-related-to-cost-reduction-budgeting-savings-financial-close-up-view-433957574.jpg';
      case 'Production Planning':
        return 'https://st2.depositphotos.com/1439888/11370/i/450/depositphotos_113705422-stock-photo-production-panning-concept-on-the.jpg';
      case 'Quality Control':
        return 'https://t3.ftcdn.net/jpg/04/38/61/36/360_F_438613643_ErB3cBJ3eI38XbJE5cJZcOttEcTtfLik.jpg';
      case 'Delivery':
        return 'https://png.pngtree.com/thumb_back/fh260/background/20250415/pngtree-logistic-and-transportation-concept-showing-a-world-map-network-with-freight-image_17184384.jpg';
      case 'Benchmark Analysis':
        return 'https://thumbs.dreamstime.com/b/benchmark-businessman-hologram-concept-benchmark-businessman-hologram-concept-futuristic-177138441.jpg';
      default:
        return null;
    }
  };

  const moduleImage = getModuleImage(title);

  return (
    <div className="w-full">
      <GlareCard 
        className={`p-3 ${!isDisabled ? 'cursor-pointer hover:bg-muted/30 transition-colors' : 'cursor-not-allowed opacity-60'}`}
        onClick={() => {
          if (!isDisabled && onClick) {
            onClick();
          }
        }}
      >
        <div className="flex flex-col space-y-2">
          {/* Header with Badge - only show if coming soon */}
          {status === 'coming-soon' && (
            <Badge variant="outline" className="text-xs text-muted-foreground border-border/50 w-fit">
              Coming Soon
            </Badge>
          )}

          {/* Module Image */}
          {moduleImage && (
            <div className="rounded-md overflow-hidden h-20 bg-secondary/50">
              <img 
                src={moduleImage} 
                alt={title}
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* Content */}
          <div className="space-y-1">
            <CardTitle className="text-sm font-semibold flex items-center gap-1 text-foreground">
              {title}
              {status === 'active' && <CheckCircle2 className="h-3 w-3 text-green-500" />}
              {status === 'available' && <Clock className="h-3 w-3 text-primary" />}
              {status === 'coming-soon' && <AlertCircle className="h-3 w-3 text-muted-foreground" />}
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground line-clamp-2 leading-tight">
              {description}
            </CardDescription>
          </div>

          {/* Button */}
          <Button
            size="sm"
            className="w-auto px-3 gap-1 group bg-primary/10 hover:bg-primary/20 text-primary border-primary/30 hover:border-primary/50 h-7 text-xs mx-auto"
            variant="outline"
            disabled={isDisabled}
            onClick={(e) => {
              e.stopPropagation(); // Prevent card click when button is clicked
              if (!isDisabled && onClick) {
                onClick();
              }
            }}
          >
            {isDisabled ? (
              'Coming Soon'
            ) : (
              <>
                Open Module
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </Button>
        </div>
      </GlareCard>
    </div>
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
      borderColor: 'border-l-4 border-l-violet-500',
      status: 'available' as const,
      onClick: () => {
        router.push(`/vave?sourceProjectId=${projectId}`);
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {modules.map((module) => (
          <ModuleCard key={module.title} {...module} />
        ))}
      </div>
    </div>
  );
}
