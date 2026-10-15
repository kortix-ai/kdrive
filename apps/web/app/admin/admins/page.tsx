import type { Metadata } from 'next';
import { AdminsSection } from '@/components/admin/sections';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: 'Admins' };

export default async function Page() {
  await requireAdminPage();
  return <AdminsSection />;
}
