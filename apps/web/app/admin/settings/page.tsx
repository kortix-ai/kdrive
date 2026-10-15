import type { Metadata } from 'next';
import { ServerSettings } from '@/components/admin/server-settings';
import { requireAdminPage } from '@/lib/admin-gate';

export const metadata: Metadata = { title: 'Settings' };

export default async function Page() {
  await requireAdminPage();
  return <ServerSettings />;
}
