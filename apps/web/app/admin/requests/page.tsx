import type { Metadata } from 'next';
import { RequestsSection } from '@/components/admin/sections';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: 'Storage requests' };

export default async function Page() {
  await requireAdminPage();
  return <RequestsSection />;
}
