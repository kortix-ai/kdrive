import type { Metadata } from 'next';
import { UsersSection } from '@/components/admin/sections';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: 'Users' };

export default async function Page() {
  await requireAdminPage();
  return <UsersSection />;
}
