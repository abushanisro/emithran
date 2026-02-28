'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import DeliveryOrderWorkflow from '@/components/features/delivery/DeliveryOrderWorkflow';
import DeliveryTracking from '@/components/features/delivery/DeliveryTracking';

export default function DeliveryPage() {
  const params = useParams();
  const projectId = params.id as string;
  
  // Date range for tracking (default to last 30 days)
  const [dateRange] = useState({
    from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to: new Date().toISOString()
  });

  const handleOrderComplete = () => {
    // Refresh tracking data or show success message
    console.log('Order created successfully');
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <Tabs defaultValue="create-order" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="create-order">Create Delivery Order</TabsTrigger>
            <TabsTrigger value="tracking">Track Deliveries</TabsTrigger>
          </TabsList>
          
          <TabsContent value="create-order" className="space-y-6">
            <DeliveryOrderWorkflow 
              projectId={projectId} 
              onComplete={handleOrderComplete}
            />
          </TabsContent>
          
          <TabsContent value="tracking" className="space-y-6">
            <DeliveryTracking 
              projectId={projectId}
              dateRange={dateRange}
            />
          </TabsContent>
        </Tabs>
        
        {/* Workflow Navigation */}
        <div className="mt-12">
          <WorkflowNavigation 
            currentModuleId="delivery" 
            projectId={projectId}
          />
        </div>
      </div>
    </div>
  );
}