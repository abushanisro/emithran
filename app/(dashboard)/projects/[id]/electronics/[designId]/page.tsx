'use client';

import { useParams } from 'next/navigation';

import { ElectronicsDesignWorkspace } from '@/components/features/electronics/ElectronicsDesignWorkspace';

export default function ProjectElectronicsDesignPage() {
  const params = useParams<{ id: string; designId: string }>();
  return <ElectronicsDesignWorkspace projectId={params.id} designId={params.designId} />;
}
