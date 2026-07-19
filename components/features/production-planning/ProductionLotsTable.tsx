'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  MoreHorizontal, 
  Eye, 
  Edit, 
  Trash2, 
  Play, 
  Pause, 
  CheckCircle,
  Calendar,
  Package,
  TrendingUp
} from 'lucide-react';
import { format } from 'date-fns';
import { ProductionLot, useDeleteProductionLot } from '@/lib/api/hooks/useProductionPlanning';

interface ProductionLotsTableProps {
  lots: ProductionLot[];
  isLoading: boolean;
}

export function ProductionLotsTable({ lots, isLoading }: ProductionLotsTableProps) {
  const router = useRouter();
  const [selectedLot, setSelectedLot] = useState<ProductionLot | null>(null);
  const deleteProductionLot = useDeleteProductionLot();

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      planned: { variant: 'outline', color: 'text-blue-600', bg: 'bg-blue-100' },
      materials_ordered: { variant: 'secondary', color: 'text-yellow-600', bg: 'bg-yellow-100' },
      in_production: { variant: 'default', color: 'text-green-600', bg: 'bg-green-100' },
      completed: { variant: 'default', color: 'text-green-800', bg: 'bg-green-200' },
      cancelled: { variant: 'destructive', color: 'text-red-600', bg: 'bg-red-100' },
      on_hold: { variant: 'secondary', color: 'text-orange-600', bg: 'bg-orange-100' },
    } as const;

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.planned;
    
    return (
      <Badge 
        variant={config.variant as any}
        className={`${config.color} ${config.bg} border-0`}
      >
        {status.replace('_', ' ').toUpperCase()}
      </Badge>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const priorityConfig = {
      low: { variant: 'outline', color: 'text-gray-600' },
      medium: { variant: 'secondary', color: 'text-blue-600' },
      high: { variant: 'default', color: 'text-orange-600' },
      urgent: { variant: 'destructive', color: 'text-red-600' },
    } as const;

    const config = priorityConfig[priority as keyof typeof priorityConfig] || priorityConfig.medium;
    
    return (
      <Badge variant={config.variant as any} className={config.color}>
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const handleViewLot = (lot: ProductionLot) => {
    router.push(`/production-planning/${lot.id}`);
  };

  const handleEditLot = (lot: ProductionLot) => {
    router.push(`/production-planning/${lot.id}/edit`);
  };

  const handleDeleteLot = (lot: ProductionLot) => {
    if (confirm(`Are you sure you want to delete production lot ${lot.lotNumber}? This action cannot be undone.`)) {
      deleteProductionLot.mutate(lot.id);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-muted animate-pulse rounded-md" />
        ))}
      </div>
    );
  }

  if (!lots.length) {
    return (
      <div className="text-center py-12">
        <Package className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground mb-2">No Production Lots Found</h3>
        <p className="text-sm text-muted-foreground">
          Create your first production lot to get started with manufacturing planning
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lot Number</TableHead>
            <TableHead>BOM</TableHead>
            <TableHead>Quantity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Start Date</TableHead>
            <TableHead>End Date</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Cost</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lots.map((lot) => (
            <TableRow 
              key={lot.id} 
              className="hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => handleViewLot(lot)}
            >
              <TableCell className="font-medium">
                <div className="flex flex-col">
                  <span className="font-semibold">{lot.lotNumber}</span>
                  <span className="text-xs text-muted-foreground">{lot.lotType}</span>
                </div>
              </TableCell>
              
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{lot.bom?.name || 'N/A'}</span>
                  <span className="text-xs text-muted-foreground">v{lot.bom?.version || '1.0'}</span>
                </div>
              </TableCell>
              
              <TableCell>
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  {lot.productionQuantity.toLocaleString()}
                </div>
              </TableCell>
              
              <TableCell>
                {getStatusBadge(lot.status)}
              </TableCell>
              
              <TableCell>
                {getPriorityBadge(lot.priority)}
              </TableCell>
              
              <TableCell>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {lot.plannedStartDate && !isNaN(new Date(lot.plannedStartDate).getTime()) 
                    ? format(new Date(lot.plannedStartDate), 'MMM dd, yyyy')
                    : 'Not set'
                  }
                </div>
              </TableCell>
              
              <TableCell>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {lot.plannedEndDate && !isNaN(new Date(lot.plannedEndDate).getTime()) 
                    ? format(new Date(lot.plannedEndDate), 'MMM dd, yyyy')
                    : 'Not set'
                  }
                </div>
              </TableCell>
              
              <TableCell>
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all duration-300"
                        style={{ 
                          width: `${lot.processes?.length 
                            ? Math.round(lot.processes.reduce((sum, p) => sum + p.completionPercentage, 0) / lot.processes.length)
                            : 0}%` 
                        }}
                      />
                    </div>
                    <TrendingUp className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {lot.processes?.filter(p => p.status === 'completed').length || 0} / {lot.processes?.length || 0} processes
                  </span>
                </div>
              </TableCell>
              
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-semibold">${lot.totalEstimatedCost.toLocaleString()}</span>
                  <span className="text-xs text-muted-foreground">
                    Material: ${lot.totalMaterialCost.toLocaleString()}
                  </span>
                </div>
              </TableCell>
              
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={() => handleViewLot(lot)}>
                      <Eye className="h-4 w-4 mr-2" />
                      View Details
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleEditLot(lot)}>
                      <Edit className="h-4 w-4 mr-2" />
                      Edit Lot
                    </DropdownMenuItem>
                    {lot.status === 'planned' && (
                      <DropdownMenuItem>
                        <Play className="h-4 w-4 mr-2" />
                        Start Production
                      </DropdownMenuItem>
                    )}
                    {lot.status === 'in_production' && (
                      <DropdownMenuItem>
                        <Pause className="h-4 w-4 mr-2" />
                        Pause Production
                      </DropdownMenuItem>
                    )}
                    {lot.status === 'in_production' && (
                      <DropdownMenuItem>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Mark Complete
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteLot(lot);
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}