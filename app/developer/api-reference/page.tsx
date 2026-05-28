import { redirect } from 'next/navigation';
import { API_SPEC } from '@/lib/docs/api-spec';
import { getFirstEndpoint } from '@/lib/docs/docs-navigation';

export default function ApiReferencePage() {
  const first = getFirstEndpoint(API_SPEC);
  if (first) {
    redirect(`/developer/api-reference/${first.section}/${first.endpoint}`);
  }
  redirect('/developer');
}
