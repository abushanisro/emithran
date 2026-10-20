'use client';

import { useParams } from 'next/navigation';

import { ElectronicsBomPage } from '@/components/features/electronics/ElectronicsBomPage';

export default function ProjectElectronicsPage() {
  const params = useParams<{ id: string }>();
  return <ElectronicsBomPage projectId={params.id} />;
}
