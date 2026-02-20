'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  ArrowRight, 
  ArrowLeft, 
  Clock,
  CheckCircle,
  Circle,
  Lock,
  Package,
  Cog,
  DollarSign,
  Search,
  UserCheck,
  FileText,
  Calendar,
  Shield,
  Truck,
  FolderKanban,
  CircleCheckBig
} from 'lucide-react';
import { 
  WORKFLOW_MODULES, 
  getNextModule, 
  getPreviousModule, 
  getModuleProgress,
  WorkflowModule 
} from '@/lib/constants/module-workflow';

interface WorkflowNavigationProps {
  currentModuleId: string;
  projectId: string;
  showFullWorkflow?: boolean;
}

const getIcon = (iconName: string) => {
  const icons: Record<string, React.ComponentType<any>> = {
    Package,
    Cog,
    DollarSign,
    Search,
    UserCheck,
    FileText,
    Calendar,
    Shield,
    Truck,
  };
  return icons[iconName] || Circle;
};

export const WorkflowNavigation: React.FC<WorkflowNavigationProps> = ({
  currentModuleId,
  projectId,
  showFullWorkflow = false,
}) => {
  const router = useRouter();
  
  const nextModule = getNextModule(currentModuleId);
  const previousModule = getPreviousModule(currentModuleId);
  const progress = getModuleProgress(currentModuleId);
  const currentModule = WORKFLOW_MODULES.find(m => m.id === currentModuleId);
  
  // Check if workflow is completed (at the last module with 100% progress)
  const isWorkflowComplete = !nextModule && progress >= 100;

  const handleModuleNavigation = (module: WorkflowModule) => {
    const route = module.route.replace('[id]', projectId);
    router.push(route);
  };

  const getStatusColor = (status: WorkflowModule['status']) => {
    switch (status) {
      case 'completed': return 'text-green-600 bg-green-100 border-green-200';
      case 'current': return 'text-blue-600 bg-blue-100 border-blue-200';
      case 'pending': return 'text-orange-600 bg-orange-100 border-orange-200';
      case 'locked': return 'text-gray-400 bg-gray-100 border-gray-200';
      default: return 'text-gray-600 bg-gray-100 border-gray-200';
    }
  };

  const getStatusIcon = (status: WorkflowModule['status']) => {
    switch (status) {
      case 'completed': return CheckCircle;
      case 'current': return Circle;
      case 'locked': return Lock;
      default: return Circle;
    }
  };

  if (showFullWorkflow) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Manufacturing Workflow</h3>
              <p className="text-sm text-muted-foreground">Complete end-to-end process</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Progress</p>
              <p className="text-lg font-bold text-primary">{progress.toFixed(0)}%</p>
            </div>
          </div>
          
          <Progress value={progress} className="mb-6" />
          
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {WORKFLOW_MODULES.map((module, index) => {
              const IconComponent = getIcon(module.icon);
              const StatusIcon = getStatusIcon(module.status);
              const isCurrent = module.id === currentModuleId;
              
              return (
                <div 
                  key={module.id}
                  className={`p-4 border rounded-lg transition-all cursor-pointer hover:shadow-md ${
                    isCurrent ? 'border-primary bg-primary/5' : getStatusColor(module.status)
                  }`}
                  onClick={() => handleModuleNavigation(module)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <IconComponent className="w-5 h-5" />
                    <StatusIcon className="w-4 h-4" />
                  </div>
                  <h4 className="font-medium text-sm mb-1">{module.name}</h4>
                  <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
                    {module.description}
                  </p>
                  {module.estimatedTime && (
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span className="text-xs">{module.estimatedTime}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Show celebration when workflow is complete
  if (isWorkflowComplete) {
    return (
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            {/* Back Button */}
            <div className="flex items-center gap-4">
              {previousModule && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleModuleNavigation(previousModule)}
                  className="flex items-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {previousModule.name}
                </Button>
              )}
            </div>

            {/* Celebration Content */}
            <div className="flex-1 mx-6">
              <div className="text-center space-y-4">
                <div>
                  <h3 className="text-xl font-bold text-foreground mb-2">🎉 Workflow Complete!</h3>
                  <p className="text-muted-foreground">
                    Congratulations! You have successfully completed the entire manufacturing workflow from BOM to delivery.
                  </p>
                </div>
                <div className="flex justify-center gap-3">
                  <Button variant="outline" className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Export Report
                  </Button>
                  <Button 
                    onClick={() => router.push('/projects')}
                    className="flex items-center gap-2"
                  >
                    Start New Project
                  </Button>
                </div>
              </div>
            </div>

            {/* Complete Badge */}
            <div>
              <Badge variant="secondary" className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                100% Complete
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {previousModule && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleModuleNavigation(previousModule)}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                {previousModule.name}
              </Button>
            )}
            
            {currentModule && (
              <div className="flex items-center gap-3">
                <Badge variant="default" className="flex items-center gap-1">
                  {React.createElement(getIcon(currentModule.icon), { className: "w-3 h-3" })}
                  Current: {currentModule.name}
                </Badge>
                <div className="hidden md:block">
                  <Progress value={progress} className="w-32" />
                </div>
                <span className="text-sm text-muted-foreground hidden md:inline">
                  {progress.toFixed(0)}% Complete
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {nextModule && (
              <div className="text-right hidden md:block">
                <p className="text-xs text-muted-foreground">Next Module</p>
                <p className="text-sm font-medium">{nextModule.name}</p>
              </div>
            )}
            
            {nextModule ? (
              <Button
                onClick={() => handleModuleNavigation(nextModule)}
                className="flex items-center gap-2"
                size="sm"
              >
                <span className="hidden md:inline">Continue to</span>
                {nextModule.name}
                <ArrowRight className="w-4 h-4" />
              </Button>
            ) : (
              <Badge variant="secondary" className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Workflow Complete
              </Badge>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};