import type { Metadata } from 'next';
import { Drives } from '@/components/admin/drives';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: 'Drives' };

export default async function Page() {
  await requireAdminPage();
  return <Drives />;
}
