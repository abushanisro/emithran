'use client';

import { useParams } from 'next/navigation';

import { ElectronicsIntelligencePage } from '@/components/features/electronics/ElectronicsIntelligencePage';

// Full screen like the part manufacturing-intelligence page: the app layout drops its header and padding for this route.
export default function ElectronicsManufacturingIntelligencePage() {
  const params = useParams<{ id: string; designId: string }>();
  return <ElectronicsIntelligencePage projectId={params.id} designId={params.designId} />;
}
